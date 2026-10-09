import {beforeEach, describe, expect, it} from 'vitest';
import {tableForFile, type TableDef} from '../gtfs/schema.ts';
import {openMemoryDb} from '../test-fixtures/test-db.ts';
import {createGtfsIndexes, createGtfsTables} from './ddl.ts';
import {IssueCollector} from './issues.ts';
import type {Database} from './sqlite.ts';
import {createExtraFileWriter, createTableWriter} from './table-writer.ts';

function def(file: string): TableDef {
  const found = tableForFile(file);
  if (found === undefined) throw new Error(`no table for ${file}`);
  return found;
}

describe('table writers', () => {
  let db: Database;
  let issues: IssueCollector;
  let rows: number;

  beforeEach(async () => {
    db = await openMemoryDb();
    createGtfsTables(db);
    issues = new IssueCollector(db);
    rows = 0;
  });

  const onRow = (): void => {
    rows++;
  };

  it('creates every GTFS table plus time-seconds columns', () => {
    const columns = db.selectValues("SELECT name FROM pragma_table_info('stop_times')");
    expect(columns).toContain('arrival_time');
    expect(columns).toContain('arrival_secs');
    expect(columns).toContain('departure_secs');
    const tables = db.selectValues("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables).toEqual(
      expect.arrayContaining(['agency', 'stops', 'stop_times', 'extra_files', 'import_issues']),
    );
  });

  it('converts typed values and stores both time forms', () => {
    const header = ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'extra'];
    const writer = createTableWriter(db, def('stop_times.txt'), header, issues, onRow);
    if (writer === null) throw new Error('writer should exist');
    writer.write(['T1', '25:30:00', '', 'S1', '3', 'ignored'], 2);
    expect(writer.finish()).toBe(1);
    expect(rows).toBe(1);
    expect(
      db.selectObjects(
        'SELECT trip_id, arrival_time, arrival_secs, departure_time, departure_secs, stop_sequence FROM stop_times',
      ),
    ).toEqual([
      {
        trip_id: 'T1',
        arrival_time: '25:30:00',
        arrival_secs: 91800,
        departure_time: null,
        departure_secs: null,
        stop_sequence: 3,
      },
    ]);
  });

  it('records invalid values and ragged rows without dropping the row', () => {
    const header = ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'];
    const writer = createTableWriter(db, def('stops.txt'), header, issues, onRow);
    if (writer === null) throw new Error('writer should exist');
    writer.write(['S1', 'Main', 'north', '-122.1', 'x'], 2);
    writer.write(['S2', 'Short'], 3);
    writer.finish();
    expect(db.selectObjects('SELECT stop_id, stop_lat, location_type FROM stops')).toEqual([
      {stop_id: 'S1', stop_lat: null, location_type: null},
      {stop_id: 'S2', stop_lat: null, location_type: null},
    ]);
    expect(db.selectValues('SELECT code FROM import_issues ORDER BY rowid')).toEqual([
      'invalid_value',
      'invalid_value',
      'ragged_row',
    ]);
  });

  it('records a missing required value', () => {
    const writer = createTableWriter(db, def('stops.txt'), ['stop_id', 'stop_name'], issues, onRow);
    if (writer === null) throw new Error('writer should exist');
    writer.write(['', 'Nameless'], 2);
    writer.finish();
    expect(db.selectValue("SELECT count(*) FROM import_issues WHERE code = 'missing_value'")).toBe(1);
  });

  it('refuses a required file missing a required column (fatal)', () => {
    const header = ['trip_id', 'stop_id', 'arrival_time'];
    expect(createTableWriter(db, def('stop_times.txt'), header, issues, onRow)).toBeNull();
    expect(issues.hasFatal()).toBe(true);
    expect(issues.fatalIssues()[0]?.column).toBe('stop_sequence');
  });

  it('skips an optional file missing a required column (non-fatal)', () => {
    const header = ['shape_id', 'shape_pt_lat', 'shape_pt_lon'];
    expect(createTableWriter(db, def('shapes.txt'), header, issues, onRow)).toBeNull();
    expect(issues.hasFatal()).toBe(false);
    expect(issues.totalCount()).toBe(1);
  });

  it('stores unknown files as JSON rows', () => {
    const writer = createExtraFileWriter(db, 'transfers.txt', ['from_stop_id', 'to_stop_id'], onRow);
    writer.write(['A', 'B'], 2);
    writer.finish();
    expect(db.selectObjects('SELECT file_name, line, json FROM extra_files')).toEqual([
      {file_name: 'transfers.txt', line: 2, json: '{"from_stop_id":"A","to_stop_id":"B"}'},
    ]);
  });

  it('creates indexes after load', () => {
    createGtfsIndexes(db);
    const indexes = db.selectValues("SELECT name FROM sqlite_master WHERE type = 'index'");
    expect(indexes).toContain('idx_stop_times_stop_id');
    expect(indexes).toContain('idx_stop_times_trip_id_stop_sequence');
  });
});
