import {GTFS_TABLES} from '../gtfs/schema.ts';
import {isValidTimeZone} from '../gtfs/time.ts';
import type {IssueCollector} from './issues.ts';
import type {Database} from './sqlite.ts';
import {asNumber, asString} from './sql-values.ts';

type Position = [number, number];

const UNIT_SEPARATOR = '\u001f';

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function lineString(coordinates: readonly Position[]): string {
  return JSON.stringify({type: 'LineString', coordinates});
}

function buildPatterns(db: Database): void {
  db.exec(`
    CREATE TABLE route_patterns (
      pattern_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      direction_id INTEGER NOT NULL,
      stop_ids_json TEXT NOT NULL,
      trip_count INTEGER NOT NULL,
      rep_trip_id TEXT NOT NULL,
      shape_id TEXT,
      headsign TEXT
    );
    CREATE TEMP TABLE trip_seq AS
      SELECT trip_id, group_concat(stop_id, char(31) ORDER BY stop_sequence) AS stop_key
      FROM stop_times GROUP BY trip_id;
  `);
  const groups = db.selectObjects(`
    SELECT t.route_id AS route_id, COALESCE(t.direction_id, 0) AS direction_id, s.stop_key AS stop_key,
           count(*) AS trip_count, min(t.trip_id) AS rep_trip_id
    FROM trips t JOIN temp.trip_seq s ON s.trip_id = t.trip_id
    WHERE t.route_id IS NOT NULL
    GROUP BY t.route_id, COALESCE(t.direction_id, 0), s.stop_key
    ORDER BY t.route_id, direction_id, trip_count DESC, rep_trip_id
  `);
  const repTrip = db.prepare('SELECT shape_id, trip_headsign FROM trips WHERE trip_id = ? LIMIT 1');
  const insert = db.prepare('INSERT INTO route_patterns VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const counters = new Map<string, number>();
  for (const group of groups) {
    const routeId = asString(group['route_id']) ?? '';
    const directionId = asNumber(group['direction_id']) ?? 0;
    const repTripId = asString(group['rep_trip_id']) ?? '';
    const key = `${routeId}:${directionId}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    let shapeId: string | null = null;
    let headsign: string | null = null;
    repTrip.bind([repTripId]);
    if (repTrip.step()) {
      const row = repTrip.get({});
      shapeId = asString(row['shape_id']);
      headsign = asString(row['trip_headsign']);
    }
    repTrip.reset();
    const stopIds = (asString(group['stop_key']) ?? '').split(UNIT_SEPARATOR);
    insert
      .bind([
        `${key}:${n}`,
        routeId,
        directionId,
        JSON.stringify(stopIds),
        asNumber(group['trip_count']) ?? 0,
        repTripId,
        shapeId,
        headsign,
      ])
      .stepReset();
  }
  repTrip.finalize();
  insert.finalize();
  db.exec('DROP TABLE temp.trip_seq; CREATE INDEX idx_route_patterns_route_id ON route_patterns (route_id);');
}

function buildShapes(db: Database): void {
  db.exec(`
    CREATE TABLE route_shapes (
      route_id TEXT NOT NULL,
      shape_id TEXT NOT NULL,
      geojson TEXT NOT NULL,
      PRIMARY KEY (route_id, shape_id)
    )
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO route_shapes VALUES (?, ?, ?)');
  const shapePoints = db.prepare(
    'SELECT shape_pt_lon, shape_pt_lat FROM shapes WHERE shape_id = ? AND shape_pt_lat IS NOT NULL AND shape_pt_lon IS NOT NULL ORDER BY shape_pt_sequence',
  );
  // Caches only the serialized LineString per shape (null when fewer than 2 usable points),
  // so full coordinate arrays are never held for every shape at once.
  const cache = new Map<string, string | null>();
  const lineForShape = (shapeId: string): string | null => {
    const cached = cache.get(shapeId);
    if (cached !== undefined) return cached;
    const coords: Position[] = [];
    shapePoints.bind([shapeId]);
    while (shapePoints.step()) {
      coords.push([round6(Number(shapePoints.get(0))), round6(Number(shapePoints.get(1)))]);
    }
    shapePoints.reset();
    const line = coords.length >= 2 ? lineString(coords) : null;
    cache.set(shapeId, line);
    return line;
  };

  const used = db.selectObjects(
    'SELECT DISTINCT route_id, shape_id FROM trips WHERE route_id IS NOT NULL AND shape_id IS NOT NULL',
  );
  for (const row of used) {
    const routeId = asString(row['route_id']) ?? '';
    const shapeId = asString(row['shape_id']) ?? '';
    const line = lineForShape(shapeId);
    if (line !== null) insert.bind([routeId, shapeId, line]).stepReset();
  }

  // Patterns whose representative trip has no usable shape get a line through their stops.
  const stopCoords = new Map<string, Position>();
  for (const stop of db.selectObjects(
    'SELECT stop_id, stop_lon, stop_lat FROM stops WHERE stop_lat IS NOT NULL AND stop_lon IS NOT NULL',
  )) {
    stopCoords.set(asString(stop['stop_id']) ?? '', [
      round6(asNumber(stop['stop_lon']) ?? 0),
      round6(asNumber(stop['stop_lat']) ?? 0),
    ]);
  }
  for (const pattern of db.selectObjects(
    'SELECT pattern_id, route_id, shape_id, stop_ids_json FROM route_patterns',
  )) {
    const shapeId = asString(pattern['shape_id']);
    if (shapeId !== null && lineForShape(shapeId) !== null) continue;
    const stopIds: unknown = JSON.parse(asString(pattern['stop_ids_json']) ?? '[]');
    if (!Array.isArray(stopIds)) continue;
    const coords: Position[] = [];
    for (const stopId of stopIds) {
      const position = typeof stopId === 'string' ? stopCoords.get(stopId) : undefined;
      if (position !== undefined) coords.push(position);
    }
    if (coords.length < 2) continue;
    insert
      .bind([
        asString(pattern['route_id']) ?? '',
        `stops:${asString(pattern['pattern_id']) ?? ''}`,
        lineString(coords),
      ])
      .stepReset();
  }
  shapePoints.finalize();
  insert.finalize();
}

function buildStopRoutes(db: Database): void {
  db.exec(`
    CREATE TABLE stop_routes (
      stop_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      PRIMARY KEY (stop_id, route_id)
    ) WITHOUT ROWID;
    INSERT OR IGNORE INTO stop_routes
      SELECT DISTINCT st.stop_id, t.route_id
      FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id
      WHERE st.stop_id IS NOT NULL AND t.route_id IS NOT NULL;
    INSERT OR IGNORE INTO stop_routes
      SELECT DISTINCT s.parent_station, sr.route_id
      FROM stop_routes sr JOIN stops s ON s.stop_id = sr.stop_id
      WHERE s.parent_station IS NOT NULL;
  `);
}

function buildSummary(db: Database, issues: IssueCollector): void {
  db.exec('CREATE TABLE feed_summary (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO feed_summary VALUES (?, ?)');
  for (const def of GTFS_TABLES) {
    const count = Number(db.selectValue(`SELECT count(*) FROM ${def.table}`));
    insert.bind([`count:${def.table}`, String(count)]).stepReset();
  }
  const range = db.selectObject(`
    SELECT min(d) AS start, max(d) AS end FROM (
      SELECT start_date AS d FROM calendar
      UNION ALL SELECT end_date FROM calendar
      UNION ALL SELECT date FROM calendar_dates WHERE exception_type = 1
    ) WHERE d IS NOT NULL
  `);
  const start = asString(range?.['start']);
  const end = asString(range?.['end']);
  if (start !== null) insert.bind(['service_start', start]).stepReset();
  if (end !== null) insert.bind(['service_end', end]).stepReset();
  const timeZone = asString(db.selectValue('SELECT agency_timezone FROM agency LIMIT 1'));
  if (timeZone !== null && isValidTimeZone(timeZone)) {
    insert.bind(['timezone', timeZone]).stepReset();
  } else {
    issues.add({
      severity: 'warning',
      file: 'agency.txt',
      line: null,
      column: 'agency_timezone',
      code: 'invalid_timezone',
      message: `"${timeZone ?? ''}" is not a valid time zone; the browser's time zone will be used.`,
    });
  }
  const feedLang = asString(db.selectValue('SELECT feed_lang FROM feed_info LIMIT 1'))?.trim() ?? '';
  const original = feedLang !== '' && feedLang.toLowerCase() !== 'mul' ? feedLang : null;
  const seen = new Set<string>(original === null ? [] : [original.toLowerCase()]);
  const others: string[] = [];
  const translated = db
    .selectValues('SELECT DISTINCT language FROM translations')
    .map((value) => asString(value))
    .filter((value): value is string => value !== null && value !== '')
    .sort((a, b) => {
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
  for (const language of translated) {
    if (seen.has(language.toLowerCase())) continue;
    seen.add(language.toLowerCase());
    others.push(language);
  }
  insert.bind(['languages', JSON.stringify(original === null ? others : [original, ...others])]).stepReset();
  if (original !== null) insert.bind(['original_language', original]).stepReset();
  insert.finalize();
}

export function buildDerivedTables(db: Database, issues: IssueCollector): void {
  db.exec('BEGIN');
  try {
    buildPatterns(db);
    buildShapes(db);
    buildStopRoutes(db);
    buildSummary(db, issues);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
