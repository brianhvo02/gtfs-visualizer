import {beforeAll, describe, expect, it} from 'vitest';
import {CATEGORY_COLORS} from '../gtfs/route-types.ts';
import {SAMPLE_TRANSLATIONS, TRANSLATED_FEED, withFile, withoutFile} from '../test-fixtures/sample-feed.ts';
import {loadSampleDb} from '../test-fixtures/sample-db.ts';
import {
  getFeedLanguages,
  getFeedSummary,
  getMapLabels,
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
  getStopDepartures(db, stop, date, null).map((d) => [d.tripId, d.departureSecs]);

describe('queries', () => {
  it('lists routes in display order with normalized colors', () => {
    const routes = getRoutes(db, null);
    expect(routes.map((r) => r.routeId)).toEqual(['R10', 'R20', 'R30']);
    expect(routes.map((r) => r.color)).toEqual(['#ff0000', '#00ff00', CATEGORY_COLORS.ferry]);
    expect(routes[0]?.textColor).toBe('#ffffff');
    expect(routes[2]?.category).toBe('ferry');
  });

  it('orders routes by route_id (numeric-aware) rather than by their display names', async () => {
    const routes = [
      'route_id,agency_id,route_short_name,route_long_name,route_type',
      'R10,DTA,Z,Zebra,3',
      'R20,DTA,M,Middle,3',
      'R30,DTA,A,Alpha,3',
      'R9,DTA,Q,Quebec,3',
    ].join('\n');
    const {db: byId} = await loadSampleDb(withFile('routes.txt', `${routes}\n`));
    expect(getRoutes(byId, null).map((r) => r.routeId)).toEqual(['R9', 'R10', 'R20', 'R30']);
  });

  it('keeps route_sort_order ahead of route_id', async () => {
    const routes = [
      'route_id,agency_id,route_short_name,route_long_name,route_type,route_sort_order',
      'R10,DTA,10,Airport - Central,3,',
      'R20,DTA,20,Central - Furnace Creek,3,',
      'R30,DTA,30,Harbor Ferry,4,1',
    ].join('\n');
    const {db: sorted} = await loadSampleDb(withFile('routes.txt', `${routes}\n`));
    expect(getRoutes(sorted, null).map((r) => r.routeId)).toEqual(['R30', 'R10', 'R20']);
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
    const detail = getRouteDetail(db, 'R10', null);
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
    expect(getRouteDetail(db, 'NOPE', null)).toBeNull();
    expect(getStopDetail(db, 'NOPE', null)).toBeNull();
  });

  it('lists routes serving a parent station', () => {
    const detail = getStopDetail(db, 'STN', null);
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
    const summary = getFeedSummary(db, null);
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
  it('unifies mixed-case spellings so exact-match lookups translate every record', async () => {
    const rows = [
      'table_name,field_name,language,translation,record_id',
      'stops,stop_name,FR,Gare,STN',
      'stops,stop_name,fr,Beatty fr,BEATTY',
    ];
    const files = {...TRANSLATED_FEED, 'translations.txt': rows.join('\n') + '\n'};
    const {db} = await loadSampleDb(files);
    const {languages} = getFeedLanguages(db);
    expect(languages).toHaveLength(2);
    const spelling = languages[1] ?? '';
    expect(spelling.toLowerCase()).toBe('fr');
    expect(getStopDetail(db, 'STN', spelling)?.stop.name).toBe('Gare');
    expect(getStopDetail(db, 'BEATTY', spelling)?.stop.name).toBe('Beatty fr');
  });
  it('reports no languages for a feed imported before translations existed', async () => {
    const {db} = await loadSampleDb();
    db.exec("DELETE FROM feed_summary WHERE key IN ('languages', 'original_language'); DROP TABLE translations;");
    expect(getFeedLanguages(db)).toEqual({languages: [], originalLanguage: null});
  });
});

describe('translated queries', () => {
  let tdb: Database;
  beforeAll(async () => {
    ({db: tdb} = await loadSampleDb(TRANSLATED_FEED));
  });

  it('translates stop names by id, by value, and falls back to the original', () => {
    const name = (id: string, lang: string | null): string | undefined => getStopDetail(tdb, id, lang)?.stop.name;
    expect(name('STN', 'fr')).toBe('Gare Centrale');
    expect(name('NADAV', 'fr')).toBe('Avenue Nord / Avenue D');
    expect(name('STN_A', 'fr')).toBe('Quai A'); // id beats value; first duplicate wins
    expect(name('FUR', 'fr')).toBe('Furnace Creek'); // invalid rows skipped, empty translation ignored
    expect(name('STN', 'DE')).toBe('Zentralbahnhof');
    expect(name('STN', 'es')).toBe('Central Station');
    expect(name('STN', null)).toBe('Central Station');
  });

  it('translates route names, pattern headsigns and pattern stops', () => {
    expect(getRoutes(tdb, 'fr').find((r) => r.routeId === 'R10')?.longName).toBe('Aéroport - Centre');
    const detail = getRouteDetail(tdb, 'R10', 'fr');
    const outbound = detail?.patterns.find((p) => p.directionId === 0);
    expect(outbound?.headsign).toBe('Centre');
    expect(outbound?.stops.map((s) => s.name)).toEqual(['Aéroport de Beatty', 'Avenue Nord / Avenue D', 'Quai A']);
  });

  it('translates departure headsigns at a parent station', () => {
    const byTrip = new Map(getStopDepartures(tdb, 'STN', '20261012', 'fr').map((d) => [d.tripId, d.headsign]));
    expect(byTrip.get('T10_1')).toBe('Centre');
    expect(byTrip.get('T20_1')).toBe('Furnace Creek');
  });

  it('translates agency and publisher names', () => {
    const summary = getFeedSummary(tdb, 'fr');
    expect(summary.agencies[0]?.name).toBe('Régie de transport démo');
    expect(summary.feedInfo?.publisherName).toBe('Éditeur démo');
  });

  it('builds map labels', () => {
    const labels = getMapLabels(tdb, 'fr');
    expect(labels.routes['R10']).toBe('10 · Aéroport - Centre');
    expect(labels.stops['STN']).toBe('Gare Centrale');
    expect(labels.stops['STN_A']).toBe('Quai A');
  });

  it('runs untranslated queries on a DB without a translations table', async () => {
    const {db: old} = await loadSampleDb();
    old.exec('DROP TABLE translations');
    expect(getStopDetail(old, 'STN', null)?.stop.name).toBe('Central Station');
    expect(getRoutes(old, null)).toHaveLength(3);
  });
});
