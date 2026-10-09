import type {FeatureCollection, LineString, Point} from 'geojson';
import {
  CATEGORY_COLORS,
  contrastText,
  normalizeColor,
  routeCategory,
  routeLabel,
} from '../gtfs/route-types.ts';
import {activeServiceIds, type CalendarDateRow, type CalendarRow} from '../gtfs/service.ts';
import {addDays} from '../gtfs/time.ts';
import type {
  Departure,
  FeedSummary,
  RouteDetail,
  RouteShapeProps,
  RouteSummary,
  StopDetail,
  StopProps,
  StopRef,
} from '../shared/types.ts';
import type {Database, SqlValue} from './sqlite.ts';
import {asNumber, asString} from './sql-values.ts';

type Row = Record<string, SqlValue>;

const SECONDS_PER_DAY = 86400;
const ROUTE_COLUMNS =
  'r.route_id, r.agency_id, r.route_short_name, r.route_long_name, r.route_type, r.route_color, r.route_text_color, r.route_sort_order';

function toRouteSummary(row: Row): RouteSummary {
  const routeType = asNumber(row['route_type']) ?? 3;
  const category = routeCategory(routeType);
  const color = normalizeColor(asString(row['route_color'])) ?? CATEGORY_COLORS[category];
  return {
    routeId: asString(row['route_id']) ?? '',
    agencyId: asString(row['agency_id']),
    shortName: asString(row['route_short_name']),
    longName: asString(row['route_long_name']),
    routeType,
    category,
    color,
    textColor: normalizeColor(asString(row['route_text_color'])) ?? contrastText(color),
    sortOrder: asNumber(row['route_sort_order']),
  };
}

function compareRoutes(a: RouteSummary, b: RouteSummary): number {
  if (a.sortOrder !== b.sortOrder) {
    if (a.sortOrder === null) return 1;
    if (b.sortOrder === null) return -1;
    return a.sortOrder - b.sortOrder;
  }
  return routeLabel(a).localeCompare(routeLabel(b), undefined, {numeric: true});
}

export function getRoutes(db: Database): RouteSummary[] {
  return db.selectObjects(`SELECT ${ROUTE_COLUMNS} FROM routes r`).map(toRouteSummary).sort(compareRoutes);
}

export function getRouteShapesGeoJSON(db: Database): FeatureCollection<LineString, RouteShapeProps> {
  const routes = new Map(getRoutes(db).map((route) => [route.routeId, route]));
  const features = db
    .selectObjects('SELECT route_id, shape_id, geojson FROM route_shapes ORDER BY route_id, shape_id')
    .map((row) => {
      const routeId = asString(row['route_id']) ?? '';
      const route = routes.get(routeId);
      const geometry: LineString = JSON.parse(asString(row['geojson']) ?? '{}');
      return {
        type: 'Feature' as const,
        geometry,
        properties: {
          routeId,
          shapeId: asString(row['shape_id']) ?? '',
          color: route?.color ?? CATEGORY_COLORS.other,
          name: route === undefined ? routeId : routeLabel(route),
        },
      };
    });
  return {type: 'FeatureCollection', features};
}

export function getStopsGeoJSON(db: Database): FeatureCollection<Point, StopProps> {
  const features = db
    .selectObjects(
      `SELECT stop_id, stop_name, stop_lat, stop_lon, location_type FROM stops
       WHERE stop_lat IS NOT NULL AND stop_lon IS NOT NULL AND COALESCE(location_type, 0) IN (0, 1)`,
    )
    .map((row) => {
      const stopId = asString(row['stop_id']) ?? '';
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [asNumber(row['stop_lon']) ?? 0, asNumber(row['stop_lat']) ?? 0],
        },
        properties: {
          stopId,
          name: asString(row['stop_name']) ?? stopId,
          locationType: asNumber(row['location_type']) ?? 0,
        },
      };
    });
  return {type: 'FeatureCollection', features};
}

export function getRouteDetail(db: Database, routeId: string): RouteDetail | null {
  const routeRow = db.selectObject(`SELECT ${ROUTE_COLUMNS} FROM routes r WHERE r.route_id = ?`, [routeId]);
  if (routeRow === undefined) return null;
  const patternRows = db.selectObjects(
    `SELECT pattern_id, direction_id, stop_ids_json, trip_count, shape_id, headsign
     FROM route_patterns WHERE route_id = ? ORDER BY direction_id, trip_count DESC, pattern_id`,
    [routeId],
  );
  const parsed = patternRows.map((row) => {
    const ids: unknown = JSON.parse(asString(row['stop_ids_json']) ?? '[]');
    return {row, stopIds: Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []};
  });
  const allIds = [...new Set(parsed.flatMap((p) => p.stopIds))];
  const stops = new Map<string, StopRef>();
  for (const row of db.selectObjects(
    'SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops WHERE stop_id IN (SELECT value FROM json_each(?))',
    [JSON.stringify(allIds)],
  )) {
    const stopId = asString(row['stop_id']) ?? '';
    stops.set(stopId, {
      stopId,
      name: asString(row['stop_name']) ?? stopId,
      lat: asNumber(row['stop_lat']),
      lon: asNumber(row['stop_lon']),
    });
  }
  return {
    route: toRouteSummary(routeRow),
    patterns: parsed.map(({row, stopIds}) => ({
      patternId: asString(row['pattern_id']) ?? '',
      directionId: asNumber(row['direction_id']) ?? 0,
      headsign: asString(row['headsign']),
      tripCount: asNumber(row['trip_count']) ?? 0,
      shapeId: asString(row['shape_id']),
      stops: stopIds.map((id) => stops.get(id) ?? {stopId: id, name: id, lat: null, lon: null}),
    })),
  };
}

export function getStopDetail(db: Database, stopId: string): StopDetail | null {
  const row = db.selectObject(
    'SELECT stop_id, stop_name, stop_code, stop_lat, stop_lon, location_type, parent_station FROM stops WHERE stop_id = ?',
    [stopId],
  );
  if (row === undefined) return null;
  const routes = db
    .selectObjects(
      `SELECT ${ROUTE_COLUMNS} FROM routes r JOIN stop_routes sr ON sr.route_id = r.route_id WHERE sr.stop_id = ?`,
      [stopId],
    )
    .map(toRouteSummary)
    .sort(compareRoutes);
  return {
    stop: {
      stopId,
      name: asString(row['stop_name']) ?? stopId,
      code: asString(row['stop_code']),
      lat: asNumber(row['stop_lat']),
      lon: asNumber(row['stop_lon']),
      locationType: asNumber(row['location_type']) ?? 0,
      parentStation: asString(row['parent_station']),
    },
    routes,
  };
}

function loadCalendars(db: Database): {calendar: CalendarRow[]; dates: CalendarDateRow[]} {
  const calendar = db.selectObjects('SELECT * FROM calendar').map((row) => ({
    service_id: asString(row['service_id']) ?? '',
    monday: asNumber(row['monday']),
    tuesday: asNumber(row['tuesday']),
    wednesday: asNumber(row['wednesday']),
    thursday: asNumber(row['thursday']),
    friday: asNumber(row['friday']),
    saturday: asNumber(row['saturday']),
    sunday: asNumber(row['sunday']),
    start_date: asString(row['start_date']),
    end_date: asString(row['end_date']),
  }));
  const dates = db.selectObjects('SELECT service_id, date, exception_type FROM calendar_dates').map((row) => ({
    service_id: asString(row['service_id']) ?? '',
    date: asString(row['date']),
    exception_type: asNumber(row['exception_type']),
  }));
  return {calendar, dates};
}

const DEPARTURES_SQL = `
  SELECT st.trip_id, st.stop_id, st.departure_secs, t.route_id, t.trip_headsign,
         ${ROUTE_COLUMNS}
  FROM stop_times st
  JOIN trips t ON t.trip_id = st.trip_id
  JOIN routes r ON r.route_id = t.route_id
  WHERE st.stop_id IN (SELECT stop_id FROM stops WHERE stop_id = ?1 OR parent_station = ?1)
    AND t.service_id IN (SELECT value FROM json_each(?2))
    AND st.departure_secs IS NOT NULL
    AND st.departure_secs >= ?3`;

/** Departures at a stop (or a station's platforms) on a service date, including late trips from the day before. */
export function getStopDepartures(db: Database, stopId: string, serviceDate: string): Departure[] {
  const {calendar, dates} = loadCalendars(db);
  const today = [...activeServiceIds(calendar, dates, serviceDate)];
  const yesterday = [...activeServiceIds(calendar, dates, addDays(serviceDate, -1))];
  const toDeparture = (row: Row, offset: number): Departure => {
    const route = toRouteSummary(row);
    return {
      tripId: asString(row['trip_id']) ?? '',
      stopId: asString(row['stop_id']) ?? '',
      routeId: route.routeId,
      routeShortName: route.shortName,
      routeLongName: route.longName,
      routeColor: route.color,
      routeTextColor: route.textColor,
      headsign: asString(row['trip_headsign']),
      departureSecs: (asNumber(row['departure_secs']) ?? 0) - offset,
    };
  };
  const result = [
    ...db
      .selectObjects(DEPARTURES_SQL, [stopId, JSON.stringify(yesterday), SECONDS_PER_DAY])
      .map((row) => toDeparture(row, SECONDS_PER_DAY)),
    ...db.selectObjects(DEPARTURES_SQL, [stopId, JSON.stringify(today), 0]).map((row) => toDeparture(row, 0)),
  ];
  return result.sort((a, b) => a.departureSecs - b.departureSecs || a.tripId.localeCompare(b.tripId));
}

export function getFeedSummary(db: Database): FeedSummary {
  const summary = new Map(
    db.selectObjects('SELECT key, value FROM feed_summary').map((row) => [
      asString(row['key']) ?? '',
      asString(row['value']),
    ]),
  );
  const counts: Record<string, number> = {};
  for (const [key, value] of summary) {
    if (key.startsWith('count:')) counts[key.slice('count:'.length)] = Number(value);
  }
  const info = db.selectObject(
    'SELECT feed_publisher_name, feed_version, feed_start_date, feed_end_date FROM feed_info LIMIT 1',
  );
  return {
    agencies: db.selectObjects('SELECT agency_name, agency_url, agency_timezone FROM agency').map((row) => ({
      name: asString(row['agency_name']) ?? '',
      url: asString(row['agency_url']),
      timezone: asString(row['agency_timezone']),
    })),
    feedInfo:
      info === undefined
        ? null
        : {
            publisherName: asString(info['feed_publisher_name']),
            version: asString(info['feed_version']),
            startDate: asString(info['feed_start_date']),
            endDate: asString(info['feed_end_date']),
          },
    counts,
    serviceStart: summary.get('service_start') ?? null,
    serviceEnd: summary.get('service_end') ?? null,
    timezone: summary.get('timezone') ?? null,
    issueCount: Number(db.selectValue("SELECT count(*) FROM import_issues WHERE code != 'suppressed'")),
  };
}
