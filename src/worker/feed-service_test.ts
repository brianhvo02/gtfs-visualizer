import {strToU8} from 'fflate';
import {beforeEach, describe, expect, it} from 'vitest';
import type {ImportProgress, ImportResult} from '../shared/types.ts';
import {makeZip, SAMPLE_FEED, withoutFile} from '../test-fixtures/sample-feed.ts';
import {FeedService, META_FILENAME, slugify} from './feed-service.ts';
import {MemoryFeedStore} from './feed-store.ts';
import {loadSqlite} from './sqlite.ts';

const NOW = new Date('2026-10-09T12:00:00Z');

/** Copies into an ArrayBuffer-backed array so the bytes satisfy DOM BlobPart/BodyInit types. */
function zipBytes(files = SAMPLE_FEED): Uint8Array<ArrayBuffer> {
  return new Uint8Array(makeZip(files));
}

function zipFile(name: string, files = SAMPLE_FEED): File {
  return new File([zipBytes(files)], name, {type: 'application/zip'});
}

describe('FeedService', () => {
  let store: MemoryFeedStore;
  let service: FeedService;
  let fetchImpl: (url: string) => Promise<Response>;
  let clock: number;

  beforeEach(async () => {
    store = new MemoryFeedStore(await loadSqlite());
    fetchImpl = async () => new Response(zipBytes());
    clock = NOW.getTime();
    service = new FeedService(store, {
      fetch: (url) => fetchImpl(url),
      now: () => new Date(clock++),
      estimate: async () => ({quota: 1000, usage: 400}),
    });
    service.init();
  });

  const importFile = (name = 'demo-transit.zip', files = SAMPLE_FEED): Promise<ImportResult> =>
    service.importFeed({kind: 'file', file: zipFile(name, files)}, () => {});

  it('imports an uploaded file and registers it', async () => {
    const progress: ImportProgress[] = [];
    const result = await service.importFeed(
      {kind: 'file', file: zipFile('demo-transit.zip')},
      (p) => progress.push(p),
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.feed).toMatchObject({
      id: 'demo-transit',
      name: 'Demo Transit Authority',
      sourceKind: 'file',
      sourceRef: 'demo-transit.zip',
      serviceStart: '20260101',
      serviceEnd: '20261231',
    });
    expect(service.listFeeds()).toEqual([result.feed]);
    expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(['parse', 'index', 'derive', 'register']));
    expect(service.getRoutes('demo-transit').map((r) => r.routeId)).toEqual(['R10', 'R20', 'R30']);
  });

  it('imports from a catalog entry using the catalog name and checksum', async () => {
    const result = await service.importFeed(
      {kind: 'catalog', id: 'demo', name: 'Demo (catalog)', url: 'https://r2.test/feeds/demo.zip', sha256: 'abc'},
      () => {},
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.feed).toMatchObject({id: 'demo', name: 'Demo (catalog)', sourceKind: 'catalog', catalogSha256: 'abc'});
  });

  it('derives an id from a URL', async () => {
    const result = await service.importFeed({kind: 'url', url: 'https://agency.example.com/gtfs/feed.zip'}, () => {});
    if (!result.ok) throw new Error(result.message);
    expect(result.feed.id).toBe('agency-example-com-gtfs-feed-zip');
  });

  it('explains network (CORS) failures', async () => {
    fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const result = await service.importFeed({kind: 'url', url: 'https://blocked.test/feed.zip'}, () => {});
    expect(result).toMatchObject({ok: false, code: 'network'});
    expect(result.ok ? '' : result.message).toMatch(/upload/i);
  });

  it('reports HTTP errors', async () => {
    fetchImpl = async () => new Response('nope', {status: 404});
    const result = await service.importFeed({kind: 'url', url: 'https://x.test/feed.zip'}, () => {});
    expect(result).toMatchObject({ok: false, code: 'http'});
  });

  it('rejects non-zip files and leaves nothing behind', async () => {
    const file = new File([strToU8('stop_id\n1\n')], 'stops.txt');
    const result = await service.importFeed({kind: 'file', file}, () => {});
    expect(result).toMatchObject({ok: false, code: 'not_zip'});
    expect(store.list()).toEqual([META_FILENAME]);
  });

  it('returns fatal issues and leaves nothing behind', async () => {
    const result = await importFile('broken.zip', withoutFile('stops.txt'));
    expect(result).toMatchObject({ok: false, code: 'fatal_issues'});
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual(['missing_file']);
    expect(store.list()).toEqual([META_FILENAME]);
    expect(service.listFeeds()).toEqual([]);
  });

  it('replaces a feed on re-import and removes the old database', async () => {
    const first = await importFile();
    const second = await importFile();
    if (!first.ok || !second.ok) throw new Error('import failed');
    expect(second.feed.dbFilename).not.toBe(first.feed.dbFilename);
    expect(service.listFeeds()).toHaveLength(1);
    expect(store.list().sort()).toEqual([META_FILENAME, second.feed.dbFilename].sort());
  });

  it('opens, queries, and deletes feeds', async () => {
    const result = await importFile();
    if (!result.ok) throw new Error(result.message);
    expect(service.openFeed('demo-transit')).toEqual(result.feed);
    expect(service.openFeed('missing')).toBeNull();
    expect(service.getStopDetail('demo-transit', 'STN')?.routes).toHaveLength(2);
    service.deleteFeed('demo-transit');
    expect(service.listFeeds()).toEqual([]);
    expect(store.list()).toEqual([META_FILENAME]);
    expect(() => service.getRoutes('demo-transit')).toThrow('Feed not found: demo-transit');
  });

  it('removes orphaned feed databases at startup', async () => {
    store.open('/feeds/orphan-1.db');
    service.init();
    expect(store.list()).toEqual([META_FILENAME]);
  });

  it('checks storage headroom at 3x the download size', async () => {
    expect(await service.checkStorage(100)).toEqual({ok: true, availableBytes: 600});
    expect(await service.checkStorage(300)).toEqual({ok: false, availableBytes: 600});
  });

  it('slugifies ids', () => {
    expect(slugify('Bay Area 511 (Regional)')).toBe('bay-area-511-regional');
    expect(slugify('!!!')).toBe('feed');
  });
});
