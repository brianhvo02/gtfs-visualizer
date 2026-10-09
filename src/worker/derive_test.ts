import {describe, expect, it} from 'vitest';
import {loadSampleDb} from '../test-fixtures/sample-db.ts';
import {SAMPLE_FEED, withFile} from '../test-fixtures/sample-feed.ts';

describe('buildDerivedTables', () => {
  it('groups trips into stop patterns', async () => {
    const {db} = await loadSampleDb();
    expect(
      db.selectObjects(
        'SELECT pattern_id, route_id, direction_id, stop_ids_json, trip_count, shape_id, headsign FROM route_patterns ORDER BY pattern_id',
      ),
    ).toEqual([
      {
        pattern_id: 'R10:0:1',
        route_id: 'R10',
        direction_id: 0,
        stop_ids_json: '["BEATTY","NADAV","STN_A"]',
        trip_count: 2,
        shape_id: 'SH10',
        headsign: 'Central',
      },
      {
        pattern_id: 'R10:1:1',
        route_id: 'R10',
        direction_id: 1,
        stop_ids_json: '["STN_A","NADAV","BEATTY"]',
        trip_count: 1,
        shape_id: 'SH10',
        headsign: 'Airport',
      },
      {
        pattern_id: 'R20:0:1',
        route_id: 'R20',
        direction_id: 0,
        stop_ids_json: '["STN_A","FUR"]',
        trip_count: 2,
        shape_id: null,
        headsign: 'Furnace Creek',
      },
    ]);
  });

  it('builds route geometry from shapes, or from stops when a trip has no shape', async () => {
    const {db} = await loadSampleDb();
    const rows = db.selectObjects('SELECT route_id, shape_id, geojson FROM route_shapes ORDER BY route_id');
    expect(rows.map((r) => [r['route_id'], r['shape_id']])).toEqual([
      ['R10', 'SH10'],
      ['R20', 'stops:R20:0:1'],
    ]);
    expect(JSON.parse(String(rows[0]?.['geojson']))).toEqual({
      type: 'LineString',
      coordinates: [
        [-116.784582, 36.868446],
        [-116.77, 36.9],
        [-116.76821, 36.914893],
        [-117.1331, 36.4253],
      ],
    });
    expect(JSON.parse(String(rows[1]?.['geojson']))).toEqual({
      type: 'LineString',
      coordinates: [
        [-117.1331, 36.4253],
        [-116.40094, 36.641496],
      ],
    });
  });

  it('maps stops (and their parent stations) to routes', async () => {
    const {db} = await loadSampleDb();
    const routesAt = (stop: string): unknown[] =>
      db.selectValues('SELECT route_id FROM stop_routes WHERE stop_id = ? ORDER BY route_id', [stop]);
    expect(routesAt('STN_A')).toEqual(['R10', 'R20']);
    expect(routesAt('STN')).toEqual(['R10', 'R20']);
    expect(routesAt('FUR')).toEqual(['R20']);
  });

  it('summarizes counts, service range, and timezone', async () => {
    const {db} = await loadSampleDb();
    const summary = Object.fromEntries(
      db.selectObjects('SELECT key, value FROM feed_summary').map((r) => [r['key'], r['value']]),
    );
    expect(summary['count:stops']).toBe('5');
    expect(summary['count:stop_times']).toBe('13');
    expect(summary['count:frequencies']).toBe('0');
    expect(summary['service_start']).toBe('20260101');
    expect(summary['service_end']).toBe('20261231');
    expect(summary['timezone']).toBe('America/Los_Angeles');
  });

  it('flags an invalid agency timezone', async () => {
    const agency = SAMPLE_FEED['agency.txt']?.replace('America/Los_Angeles', 'Mars/Olympus') ?? '';
    const {db, issues} = await loadSampleDb(withFile('agency.txt', agency));
    expect(db.selectValue("SELECT value FROM feed_summary WHERE key = 'timezone'")).toBeUndefined();
    expect(issues.totalCount()).toBe(1);
  });
});
