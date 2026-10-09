import {strToU8, zipSync} from 'fflate';
import {beforeEach, describe, expect, it} from 'vitest';
import type {ImportProgress} from '../shared/types.ts';
import {
  makeZip,
  SAMPLE_FEED,
  streamOf,
  withFile,
  withoutFile,
} from '../test-fixtures/sample-feed.ts';
import {openMemoryDb} from '../test-fixtures/test-db.ts';
import {createGtfsTables} from './ddl.ts';
import {IssueCollector} from './issues.ts';
import {loadGtfsZip, NotZipError} from './loader.ts';
import type {Database} from './sqlite.ts';

const EXPECTED_COUNTS: Record<string, number> = {
  agency: 1,
  stops: 5,
  routes: 3,
  trips: 5,
  stop_times: 13,
  calendar: 2,
  calendar_dates: 2,
  shapes: 4,
  feed_info: 1,
  extra_files: 1,
};

function counts(db: Database): Record<string, number> {
  return Object.fromEntries(
    Object.keys(EXPECTED_COUNTS).map((table) => [
      table,
      Number(db.selectValue(`SELECT count(*) FROM ${table}`)),
    ]),
  );
}

/**
 * Breaks the deflate stream of one entry by setting both block-type bits of its first byte
 * (block type 3 is invalid), so decompression fails inside fflate.
 */
function corruptEntry(zip: Uint8Array, name: string): Uint8Array {
  const needle = strToU8(name);
  const nameAt = Array.from({length: zip.length}, (_, i) => i).find((i) =>
    needle.every((byte, k) => zip[i + k] === byte),
  );
  if (nameAt === undefined) throw new Error(`${name} not found in zip`);
  const headerAt = nameAt - 30;
  const extraLength = zip[headerAt + 28] ?? 0;
  const out = zip.slice();
  out[nameAt + needle.length + extraLength] = (out[nameAt + needle.length + extraLength] ?? 0) | 0x06;
  return out;
}

describe('loadGtfsZip', () => {
  let db: Database;
  let issues: IssueCollector;

  beforeEach(async () => {
    db = await openMemoryDb();
    createGtfsTables(db);
    issues = new IssueCollector(db);
  });

  it('loads every file of the sample feed', async () => {
    const result = await loadGtfsZip(db, streamOf(makeZip(SAMPLE_FEED)), issues);
    expect(result.fatal).toBe(false);
    expect([...result.filesLoaded].sort()).toEqual(Object.keys(SAMPLE_FEED).sort());
    expect(counts(db)).toEqual(EXPECTED_COUNTS);
  });

  it('stores time seconds, including blanks and single-digit hours', async () => {
    await loadGtfsZip(db, streamOf(makeZip(SAMPLE_FEED)), issues);
    const secs = (trip: string, seq: number): unknown =>
      db.selectValue('SELECT departure_secs FROM stop_times WHERE trip_id = ? AND stop_sequence = ?', [
        trip,
        seq,
      ]);
    expect(secs('T10_2', 2)).toBe(86700);
    expect(secs('T10_3', 1)).toBe(32400);
    expect(secs('T10_1', 2)).toBeNull();
    expect(issues.totalCount()).toBe(0);
  });

  it('gives the same result with tiny chunks', async () => {
    await loadGtfsZip(db, streamOf(makeZip(SAMPLE_FEED), 7), issues);
    expect(counts(db)).toEqual(EXPECTED_COUNTS);
  });

  it('commits across batch boundaries', async () => {
    await loadGtfsZip(db, streamOf(makeZip(SAMPLE_FEED)), issues, {batchSize: 2});
    expect(counts(db)).toEqual(EXPECTED_COUNTS);
  });

  it('finds files inside a folder and ignores macOS junk', async () => {
    const nested: Record<string, Uint8Array> = {
      '__MACOSX/gtfs/._stops.txt': strToU8('junk'),
      'gtfs/': new Uint8Array(0),
    };
    for (const [name, text] of Object.entries(SAMPLE_FEED)) nested[`gtfs/${name}`] = strToU8(text);
    const result = await loadGtfsZip(db, streamOf(zipSync(nested)), issues);
    expect(result.fatal).toBe(false);
    expect(counts(db)).toEqual(EXPECTED_COUNTS);
    expect(issues.totalCount()).toBe(0);
  });

  it('rejects data that is not a zip', async () => {
    await expect(loadGtfsZip(db, streamOf(strToU8('stop_id\n1\n')), issues)).rejects.toBeInstanceOf(
      NotZipError,
    );
    await expect(loadGtfsZip(db, streamOf(new Uint8Array(0)), issues)).rejects.toBeInstanceOf(
      NotZipError,
    );
  });

  it('is fatal when a required file is missing', async () => {
    const result = await loadGtfsZip(db, streamOf(makeZip(withoutFile('stops.txt'))), issues);
    expect(result.fatal).toBe(true);
    expect(issues.fatalIssues().map((i) => i.code)).toEqual(['missing_file']);
  });

  it('is fatal when both calendar files are missing', async () => {
    const files = withoutFile('calendar.txt');
    delete files['calendar_dates.txt'];
    const result = await loadGtfsZip(db, streamOf(makeZip(files)), issues);
    expect(result.fatal).toBe(true);
    expect(issues.fatalIssues().map((i) => i.code)).toEqual(['missing_calendar']);
  });

  it('is fatal when a required file is empty', async () => {
    const result = await loadGtfsZip(db, streamOf(makeZip(withFile('routes.txt', ''))), issues);
    expect(result.fatal).toBe(true);
    expect(issues.fatalIssues().map((i) => i.code)).toEqual(['empty_file']);
  });

  it('skips an optional file with a missing required column', async () => {
    const shapes = 'shape_id,shape_pt_lat,shape_pt_lon\nSH10,1,2\n';
    const result = await loadGtfsZip(db, streamOf(makeZip(withFile('shapes.txt', shapes))), issues);
    expect(result.fatal).toBe(false);
    expect(db.selectValue('SELECT count(*) FROM shapes')).toBe(0);
  });

  it('is fatal when a required entry fails to decompress', async () => {
    const zip = corruptEntry(makeZip(SAMPLE_FEED), 'stop_times.txt');
    const result = await loadGtfsZip(db, streamOf(zip), issues);
    expect(result.fatal).toBe(true);
    expect(issues.fatalIssues().map((i) => i.code)).toEqual(['zip_error']);
    expect(issues.fatalIssues()[0]?.file).toBe('stop_times.txt');
  });

  it('keeps a decompression failure of an optional entry non-fatal', async () => {
    const zip = corruptEntry(makeZip(SAMPLE_FEED), 'transfers.txt');
    const result = await loadGtfsZip(db, streamOf(zip), issues);
    expect(result.fatal).toBe(false);
    expect(issues.fatalIssues()).toEqual([]);
    expect(db.selectValue('SELECT count(*) FROM stop_times')).toBe(13);
  });

  it('reports progress up to the full byte count, then indexing', async () => {
    const zip = makeZip(SAMPLE_FEED);
    const events: ImportProgress[] = [];
    await loadGtfsZip(db, streamOf(zip, 512), issues, {
      bytesTotal: zip.length,
      onProgress: (p) => events.push(p),
    });
    const parse = events.filter((e) => e.stage === 'parse');
    expect(parse.at(-1)?.bytesDone).toBe(zip.length);
    expect(parse.at(-1)?.bytesTotal).toBe(zip.length);
    expect(events.at(-1)?.stage).toBe('index');
    expect(db.selectValues("SELECT name FROM sqlite_master WHERE type = 'index'")).toContain(
      'idx_stop_times_stop_id',
    );
  });
});
