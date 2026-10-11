import {asNumber, asString} from '../../sql-values.ts';
import {haversineMeters} from '../geo.ts';
import type {CheckContext, ValidationCheck} from '../runner.ts';

/** Same-name stops closer than this are likely duplicates. */
const DUPLICATE_METERS = 2;
/** Grid cells per degree, about 11 m each. */
const CELLS_PER_DEGREE = 10_000;

interface LocatedStop {
  readonly stopId: string;
  readonly name: string;
  readonly key: string;
  readonly locationType: number;
  readonly lat: number;
  readonly lon: number;
}

function coordinateProblem(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null) return 'missing coordinates';
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'coordinates out of range';
  if (lat === 0 && lon === 0) return 'coordinates at 0,0';
  return null;
}

/** Emits coordinate problems and returns the stops that have usable coordinates. */
function emitInvalidCoords(ctx: CheckContext): LocatedStop[] {
  const located: LocatedStop[] = [];
  const rows = ctx.db.selectObjects(
    `SELECT stop_id, stop_name, stop_lat, stop_lon, COALESCE(location_type, 0) AS location_type
     FROM stops ORDER BY stop_id`,
  );
  for (const row of rows) {
    const locationType = asNumber(row['location_type']) ?? 0;
    // Generic nodes and boarding areas may lack coordinates.
    if (locationType > 2) continue;
    const stopId = asString(row['stop_id']) ?? '';
    const rawName = asString(row['stop_name']);
    const name = rawName ?? stopId;
    const lat = asNumber(row['stop_lat']);
    const lon = asNumber(row['stop_lon']);
    const problem = coordinateProblem(lat, lon);
    if (problem !== null) {
      ctx.emit('stop_invalid_coords', {stopId, message: `${name} has ${problem}.`});
    } else if (lat !== null && lon !== null) {
      located.push({stopId, name, key: (rawName ?? '').trim().toLowerCase(), locationType, lat, lon});
    }
  }
  return located;
}

function emitNearDuplicates(ctx: CheckContext, stops: readonly LocatedStop[]): void {
  const cells = new Map<string, LocatedStop[]>();
  for (const stop of stops) {
    const cell = `${Math.floor(stop.lat * CELLS_PER_DEGREE)},${Math.floor(stop.lon * CELLS_PER_DEGREE)}`;
    const list = cells.get(cell);
    if (list === undefined) cells.set(cell, [stop]);
    else list.push(stop);
  }
  for (const stop of stops) {
    const row = Math.floor(stop.lat * CELLS_PER_DEGREE);
    const col = Math.floor(stop.lon * CELLS_PER_DEGREE);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (const other of cells.get(`${row + dr},${col + dc}`) ?? []) {
          // Each pair is reported once, from its lexically smaller id.
          if (other.stopId <= stop.stopId) continue;
          if (other.key !== stop.key || other.locationType !== stop.locationType) continue;
          const distance = haversineMeters([stop.lon, stop.lat], [other.lon, other.lat]);
          if (distance >= DUPLICATE_METERS) continue;
          ctx.emit('stops_near_duplicate', {
            stopId: stop.stopId,
            details: {otherStopId: other.stopId, distanceM: distance},
            message: `${stop.name} and ${other.name} have the same name and are ${distance.toFixed(1)} m apart.`,
          });
        }
      }
    }
  }
}

async function scan(ctx: CheckContext): Promise<void> {
  const located = emitInvalidCoords(ctx);
  await ctx.checkpoint();
  emitNearDuplicates(ctx, located);
  await ctx.checkpoint();
}

/** Stops with unusable coordinates, and same-name stops on top of each other. */
export const stopsCheck: ValidationCheck = {
  ruleIds: ['stop_invalid_coords', 'stops_near_duplicate'],
  run: scan,
};
