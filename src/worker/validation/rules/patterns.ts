import {routeCategory, type RouteCategory} from '../../../gtfs/route-types.ts';
import {asNumber, asString} from '../../sql-values.ts';
import {distanceToPolylineMeters, haversineMeters, type LonLat} from '../geo.ts';
import {createNames, type Names} from '../names.ts';
import type {CheckContext, ValidationCheck} from '../runner.ts';
import type {Database} from '../../sqlite.ts';

type Statement = ReturnType<Database['prepare']>;

/** Patterns processed between checkpoints. */
const PATTERN_CHUNK = 50;
/** Speed spans shorter than this are too noisy to judge. */
const MIN_SPAN_METERS = 200;
/** A stop farther than this from its pattern's shape is reported. */
const FAR_FROM_SHAPE_METERS = 100;

export const SPEED_LIMITS_KMH: Readonly<Record<RouteCategory, number>> = {
  bus: 150,
  tram: 150,
  subway: 150,
  trolleybus: 150,
  monorail: 150,
  other: 150,
  rail: 500,
  ferry: 80,
  cable: 50,
  aerial: 50,
  funicular: 50,
};

interface PatternStop {
  readonly stopId: string;
  readonly coord: LonLat | null;
  readonly arrival: number | null;
  readonly departure: number | null;
}

interface Pending {
  readonly stop: PatternStop & {readonly coord: LonLat};
  readonly time: number;
}

function loadStopCoords(ctx: CheckContext): Map<string, LonLat> {
  const coords = new Map<string, LonLat>();
  for (const row of ctx.db.selectObjects('SELECT stop_id, stop_lat, stop_lon FROM stops')) {
    const lat = asNumber(row['stop_lat']);
    const lon = asNumber(row['stop_lon']);
    if (lat !== null && lon !== null) coords.set(asString(row['stop_id']) ?? '', [lon, lat]);
  }
  return coords;
}

async function scan(ctx: CheckContext): Promise<void> {
  const names = createNames(ctx.db);
  const stopTimes = ctx.db.prepare(
    'SELECT stop_id, arrival_secs, departure_secs FROM stop_times WHERE trip_id = ? ORDER BY stop_sequence',
  );
  const shapeQuery = ctx.db.prepare(
    `SELECT shape_pt_lon, shape_pt_lat FROM shapes
     WHERE shape_id = ? AND shape_pt_lat IS NOT NULL AND shape_pt_lon IS NOT NULL ORDER BY shape_pt_sequence`,
  );
  try {
    await scanWith(ctx, names, stopTimes, shapeQuery);
  } finally {
    stopTimes.finalize();
    shapeQuery.finalize();
    names.finalize();
  }
}

async function scanWith(
  ctx: CheckContext,
  names: Names,
  stopTimes: Statement,
  shapeQuery: Statement,
): Promise<void> {
  const {db} = ctx;
  const coords = loadStopCoords(ctx);
  const lines = new Map<string, readonly LonLat[] | null>();
  const polyline = (shapeId: string): readonly LonLat[] | null => {
    if (lines.has(shapeId)) return lines.get(shapeId) ?? null;
    const points: LonLat[] = [];
    shapeQuery.bind([shapeId]);
    while (shapeQuery.step()) {
      const row = shapeQuery.get({});
      const lon = asNumber(row['shape_pt_lon']);
      const lat = asNumber(row['shape_pt_lat']);
      if (lon !== null && lat !== null) points.push([lon, lat]);
    }
    shapeQuery.reset();
    const line = points.length >= 2 ? points : null;
    lines.set(shapeId, line);
    return line;
  };

  const patterns = db.selectObjects(
    `SELECT p.route_id, p.rep_trip_id, p.shape_id, r.route_type
     FROM route_patterns p LEFT JOIN routes r ON r.route_id = p.route_id
     ORDER BY p.pattern_id`,
  );

  let linesRoute = '';
  const reportedSpans = new Set<string>();
  const farthest = new Map<string, {routeId: string; stopId: string; meters: number}>();

  for (let start = 0; start < patterns.length; start += PATTERN_CHUNK) {
    for (const pattern of patterns.slice(start, start + PATTERN_CHUNK)) {
      const routeId = asString(pattern['route_id']) ?? '';
      if (routeId !== linesRoute) {
        // Patterns are ordered by id, so a route's patterns are adjacent: drop the previous route's polylines.
        lines.clear();
        linesRoute = routeId;
      }
      const tripId = asString(pattern['rep_trip_id']);
      if (tripId === null) continue;
      const routeType = asNumber(pattern['route_type']);
      const limit = SPEED_LIMITS_KMH[routeType === null ? 'other' : routeCategory(routeType)];

      const stops: PatternStop[] = [];
      stopTimes.bind([tripId]);
      while (stopTimes.step()) {
        const row = stopTimes.get({});
        const stopId = asString(row['stop_id']) ?? '';
        stops.push({
          stopId,
          coord: coords.get(stopId) ?? null,
          arrival: asNumber(row['arrival_secs']),
          departure: asNumber(row['departure_secs']),
        });
      }
      stopTimes.reset();

      checkSpeeds(ctx, names.stop, reportedSpans, routeId, tripId, limit, stops);

      const shapeId = asString(pattern['shape_id']);
      const line = shapeId === null ? null : polyline(shapeId);
      if (line !== null) {
        for (const stop of stops) {
          if (stop.coord === null) continue;
          const meters = distanceToPolylineMeters(stop.coord, line);
          const key = `${routeId}\u0000${stop.stopId}`;
          const prior = farthest.get(key);
          if (prior === undefined || meters > prior.meters) farthest.set(key, {routeId, stopId: stop.stopId, meters});
        }
      }
    }
    await ctx.checkpoint();
  }

  const routeLabel = names.route;
  for (const {routeId, stopId, meters} of farthest.values()) {
    if (meters <= FAR_FROM_SHAPE_METERS) continue;
    ctx.emit('stop_far_from_shape', {
      routeId,
      stopId,
      details: {distanceM: Math.round(meters)},
      message: `${names.stop(stopId)} is ${Math.round(meters)} m from route ${routeLabel(routeId)}'s line.`,
    });
  }
  await ctx.checkpoint();
}

function checkSpeeds(
  ctx: CheckContext,
  stopName: (id: string) => string,
  reported: Set<string>,
  routeId: string,
  tripId: string,
  limit: number,
  stops: readonly PatternStop[],
): void {
  let from: Pending | null = null;
  let prev: LonLat | null = null;
  let dist = 0;
  for (const s of stops) {
    if (s.coord === null) continue;
    const coord = s.coord;
    const located = {...s, coord};
    if (from === null) {
      const time = s.departure ?? s.arrival;
      if (time === null) continue;
      from = {stop: located, time};
      prev = coord;
      dist = 0;
      continue;
    }
    dist += haversineMeters(prev ?? coord, coord);
    prev = coord;
    const t = s.arrival ?? s.departure;
    if (t === null || t === from.time) continue;
    if (t > from.time && dist >= MIN_SPAN_METERS) {
      const kmh = (dist / (t - from.time)) * 3.6;
      const key = `${routeId}\u0000${from.stop.stopId}\u0000${s.stopId}`;
      if (kmh > limit && !reported.has(key)) {
        reported.add(key);
        ctx.emit('unrealistic_speed', {
          routeId,
          stopId: from.stop.stopId,
          tripId,
          details: {toStopId: s.stopId, speedKmh: Math.round(kmh)},
          message: `Trip ${tripId} travels ${Math.round(kmh)} km/h between ${stopName(from.stop.stopId)} and ${stopName(s.stopId)}.`,
        });
      }
    }
    from = {stop: located, time: s.departure ?? s.arrival ?? t};
    dist = 0;
  }
}

/** Speed between stops and distance from each stop to its pattern's shape, over representative trips. */
export const patternsCheck: ValidationCheck = {
  ruleIds: ['unrealistic_speed', 'stop_far_from_shape'],
  run: scan,
};
