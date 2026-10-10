import {asNumber, asString} from '../../sql-values.ts';
import {createNames} from '../names.ts';
import type {CheckContext, ValidationCheck} from '../runner.ts';

/** Trips scanned per batch between checkpoints. */
export const TRIP_BATCH = 2000;

interface StopTimeRow {
  readonly stopId: string;
  readonly stopSequence: number;
  readonly arrival: number | null;
  readonly departure: number | null;
}

function tooFewMessage(tripId: string, n: number): string {
  return `Trip ${tripId} has ${n} stop time${n === 1 ? '' : 's'}; a trip needs at least 2.`;
}

function checkTrip(
  ctx: CheckContext,
  stopName: (id: string) => string,
  trips: ReadonlyMap<string, string | null>,
  stops: ReadonlySet<string>,
  tripId: string,
  rows: readonly StopTimeRow[],
): void {
  if (!trips.has(tripId)) {
    ctx.emit('stop_time_unknown_trip', {
      details: {tripId},
      message: `stop_times.txt lists trip ${tripId}, which isn't in trips.txt.`,
    });
    return;
  }
  const routeId = trips.get(tripId) ?? null;

  const seenUnknown = new Set<string>();
  for (const row of rows) {
    if (stops.has(row.stopId) || seenUnknown.has(row.stopId)) continue;
    seenUnknown.add(row.stopId);
    ctx.emit('stop_time_unknown_stop', {
      routeId,
      tripId,
      message: `Trip ${tripId} stops at ${row.stopId}, which isn't in stops.txt.`,
    });
  }

  let latest: number | null = null;
  for (const row of rows) {
    const arrival = row.arrival ?? row.departure;
    const backwards =
      (latest !== null && arrival !== null && arrival < latest) ||
      (row.arrival !== null && row.departure !== null && row.departure < row.arrival);
    if (backwards) {
      ctx.emit('stop_times_out_of_order', {
        routeId,
        tripId,
        stopId: row.stopId,
        details: {stopSequence: row.stopSequence},
        message: `Trip ${tripId} goes back in time at ${stopName(row.stopId)} (stop ${row.stopSequence}).`,
      });
      break;
    }
    const known = row.departure ?? row.arrival;
    if (known !== null) latest = latest === null ? known : Math.max(latest, known);
  }

  if (rows.length < 2) {
    ctx.emit('trip_too_few_stops', {routeId, tripId, message: tooFewMessage(tripId, rows.length)});
  }
}

async function scan(ctx: CheckContext): Promise<void> {
  const {db} = ctx;
  const names = createNames(db);
  const trips = new Map<string, string | null>();
  for (const row of db.selectObjects('SELECT trip_id, route_id FROM trips')) {
    trips.set(asString(row['trip_id']) ?? '', asString(row['route_id']));
  }
  const stops = new Set<string>();
  for (const row of db.selectObjects('SELECT stop_id FROM stops')) stops.add(asString(row['stop_id']) ?? '');

  let cursor = '';
  for (;;) {
    const ids = db.selectObjects(
      'SELECT DISTINCT trip_id FROM stop_times WHERE trip_id > ? ORDER BY trip_id LIMIT ?',
      [cursor, TRIP_BATCH],
    );
    const lastId = ids.at(-1);
    if (lastId === undefined) break;
    const upper = asString(lastId['trip_id']) ?? '';
    const rows = db.selectObjects(
      `SELECT trip_id, stop_id, stop_sequence, arrival_secs, departure_secs FROM stop_times
       WHERE trip_id > ? AND trip_id <= ? ORDER BY trip_id, stop_sequence`,
      [cursor, upper],
    );
    cursor = upper;

    let i = 0;
    while (i < rows.length) {
      const tripId = asString(rows[i]?.['trip_id']) ?? '';
      const tripRows: StopTimeRow[] = [];
      while (i < rows.length && (asString(rows[i]?.['trip_id']) ?? '') === tripId) {
        const row = rows[i];
        tripRows.push({
          stopId: asString(row?.['stop_id']) ?? '',
          stopSequence: asNumber(row?.['stop_sequence']) ?? 0,
          arrival: asNumber(row?.['arrival_secs']),
          departure: asNumber(row?.['departure_secs']),
        });
        i++;
      }
      checkTrip(ctx, names.stop, trips, stops, tripId, tripRows);
    }
    await ctx.checkpoint();
  }

  const empty = db.selectObjects(
    `SELECT t.trip_id, t.route_id FROM trips t
     WHERE NOT EXISTS (SELECT 1 FROM stop_times st WHERE st.trip_id = t.trip_id)
     ORDER BY t.trip_id`,
  );
  for (const row of empty) {
    const tripId = asString(row['trip_id']) ?? '';
    ctx.emit('trip_too_few_stops', {
      routeId: asString(row['route_id']),
      tripId,
      message: tooFewMessage(tripId, 0),
    });
  }
  await ctx.checkpoint();
}

/** One scan of stop_times: unknown trips and stops, time order, and trips with too few stops. */
export const stopTimesCheck: ValidationCheck = {
  ruleIds: ['stop_time_unknown_trip', 'stop_time_unknown_stop', 'stop_times_out_of_order', 'trip_too_few_stops'],
  run: scan,
};
