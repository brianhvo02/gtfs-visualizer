import {beforeAll, describe, expect, it} from 'vitest';
import {CATEGORY_COLORS} from '../gtfs/route-types.ts';
import {SAMPLE_TRANSLATIONS, TRANSLATED_FEED, withFile, withoutFile} from '../test-fixtures/sample-feed.ts';
import {loadSampleDb} from '../test-fixtures/sample-db.ts';
import {
  getFeedLanguages,
  getFeedSummary,
  getRouteDetail,
  getRoutes,
  getRouteShapesGeoJSON,
  getStopDepartures,
  getStopDetail,
  getStopsGeoJSON,
} from './queries.ts';
import type {Database} from './sqlite.ts';

let db: Database;

beforeAll(async () => {
  ({db} = await loadSampleDb());
});

const departures = (stop: string, date: string): Array<[string, number]> =>
  getStopDepartures(db, stop, date).map((d) => [d.tripId, d.departureSecs]);

describe('queries', () => {
  it('lists routes in display order with normalized colors', () => {
    const routes = getRoutes(db);
    expect(routes.map((r) => r.routeId)).toEqual(['R10', 'R20', 'R30']);
    expect(routes.map((r) => r.color)).toEqual(['#ff0000', '#00ff00', CATEGORY_COLORS.ferry]);
    expect(routes[0]?.textColor).toBe('#ffffff');
    expect(routes[2]?.category).toBe('ferry');
  });

  it('returns route lines as GeoJSON with display properties', () => {
    const shapes = getRouteShapesGeoJSON(db);
    expect(shapes.features.map((f) => f.properties)).toEqual([
      {routeId: 'R10', shapeId: 'SH10', color: '#ff0000', name: '10 · Airport - Central'},
      {routeId: 'R20', shapeId: 'stops:R20:0:1', color: '#00ff00', name: '20 · Central - Furnace Creek'},
    ]);
  });

  it('returns stops and stations as GeoJSON points', () => {
    const stops = getStopsGeoJSON(db);
    expect(stops.features).toHaveLength(5);
    expect(stops.features[0]?.geometry.type).toBe('Point');
  });

  it('describes a route with ordered stops per pattern', () => {
    const detail = getRouteDetail(db, 'R10');
    expect(detail?.route.routeId).toBe('R10');
    expect(detail?.patterns.map((p) => [p.patternId, p.tripCount, p.headsign])).toEqual([
      ['R10:0:1', 2, 'Central'],
      ['R10:1:1', 1, 'Airport'],
    ]);
    expect(detail?.patterns[0]?.stops.map((s) => s.name)).toEqual([
      'Beatty Airport',
      'North Ave / D Ave N',
      'Central Station Platform A',
    ]);
  });

  it('returns null for unknown routes and stops', () => {
    expect(getRouteDetail(db, 'NOPE')).toBeNull();
    expect(getStopDetail(db, 'NOPE')).toBeNull();
  });

  it('lists routes serving a parent station', () => {
    const detail = getStopDetail(db, 'STN');
    expect(detail?.stop.locationType).toBe(1);
    expect(detail?.routes.map((r) => r.routeId)).toEqual(['R10', 'R20']);
  });

  it('lists a station’s departures from its platforms, including after-midnight trips', () => {
    // Monday 2026-10-12.
    expect(departures('STN', '20261012')).toEqual([
      ['T10_1', 30000],
      ['T10_3', 32400],
      ['T20_1', 36000],
      ['T10_2', 87600],
    ]);
  });

  it('includes the previous service day’s trips that run past midnight', () => {
    // Tuesday: Monday's T10_2 reaches STN_A at 24:20 = 00:20 Tuesday.
    expect(departures('STN', '20261013')[0]).toEqual(['T10_2', 1200]);
  });

  it('skips blank times', () => {
    expect(departures('NADAV', '20261012')).toEqual([
      ['T10_3', 33600],
      ['T10_2', 86700],
    ]);
  });

  it('applies calendar exceptions', () => {
    // Thursday 2026-11-26: weekday service removed, weekend service added.
    expect(departures('STN', '20261126')).toEqual([
      ['T10_2', 1200],
      ['T20_2', 43200],
    ]);
  });

  it('summarizes the feed', () => {
    const summary = getFeedSummary(db);
    expect(summary.agencies).toEqual([
      {name: 'Demo Transit Authority', url: 'https://example.com', timezone: 'America/Los_Angeles'},
    ]);
    expect(summary.feedInfo?.version).toBe('2026.10');
    expect(summary.counts['stops']).toBe(5);
    expect(summary.serviceStart).toBe('20260101');
    expect(summary.timezone).toBe('America/Los_Angeles');
    expect(summary.issueCount).toBe(0);
  });
});

describe('getFeedLanguages', () => {
  it('lists the original language first, then translations sorted, de-duplicated by case', async () => {
    const {db} = await loadSampleDb(TRANSLATED_FEED);
    expect(getFeedLanguages(db)).toEqual({languages: ['en', 'DE', 'fr'], originalLanguage: 'en'});
  });
  it('has no original language for mul or missing feed_lang', async () => {
    const mul = withFile('feed_info.txt', 'feed_publisher_name,feed_publisher_url,feed_lang\nP,https://example.com,mul\n');
    expect(getFeedLanguages((await loadSampleDb({...mul, 'translations.txt': SAMPLE_TRANSLATIONS})).db)).toEqual({
      languages: ['DE', 'fr'],
      originalLanguage: null,
    });
    const none = {...withoutFile('feed_info.txt'), 'translations.txt': SAMPLE_TRANSLATIONS};
    expect(getFeedLanguages((await loadSampleDb(none)).db).originalLanguage).toBeNull();
  });
  it('keeps the original spelling when a translation repeats it in another case', async () => {
    const files = {...TRANSLATED_FEED, 'translations.txt': 'table_name,field_name,language,translation,record_id\nstops,stop_name,EN,X,STN\n'};
    expect(getFeedLanguages((await loadSampleDb(files)).db).languages).toEqual(['en']);
  });
  it('reports no languages for a feed imported before translations existed', async () => {
    const {db} = await loadSampleDb();
    db.exec("DELETE FROM feed_summary WHERE key IN ('languages', 'original_language'); DROP TABLE translations;");
    expect(getFeedLanguages(db)).toEqual({languages: [], originalLanguage: null});
  });
});
