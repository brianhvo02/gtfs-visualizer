import {addDays, weekdayOf} from '../../../gtfs/time.ts';
import {asNumber, asString} from '../../sql-values.ts';
import {createNames} from '../names.ts';
import type {CheckContext, ValidationCheck} from '../runner.ts';

interface CalendarRange {
  readonly days: Readonly<Record<string, boolean>>;
  readonly start: string;
  readonly end: string;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/** Walks the range and stops at the first date the service runs. */
function runsOnSomeDate(range: CalendarRange, removed: ReadonlySet<string>): boolean {
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    if (range.days[weekdayOf(date)] === true && !removed.has(date)) return true;
  }
  return false;
}

function emitRoutesWithoutTrips(ctx: CheckContext, routeLabel: (id: string) => string): void {
  const rows = ctx.db.selectObjects(
    `SELECT route_id FROM routes
     WHERE route_id NOT IN (SELECT route_id FROM route_patterns)
     ORDER BY route_id`,
  );
  for (const row of rows) {
    const routeId = asString(row['route_id']) ?? '';
    ctx.emit('route_without_trips', {routeId, message: `Route ${routeLabel(routeId)} has no trips.`});
  }
}

function emitUnusedStops(ctx: CheckContext, stopName: (id: string) => string): void {
  const rows = ctx.db.selectObjects(
    `SELECT stop_id FROM stops
     WHERE COALESCE(location_type, 0) IN (0, 1)
       AND stop_id NOT IN (SELECT stop_id FROM stop_routes)
     ORDER BY stop_id`,
  );
  for (const row of rows) {
    const stopId = asString(row['stop_id']) ?? '';
    ctx.emit('stop_unused', {stopId, message: `${stopName(stopId)} isn't served by any trip.`});
  }
}

function emitInactiveServices(ctx: CheckContext, routeLabel: (id: string) => string): void {
  const {db} = ctx;
  const ranges = new Map<string, CalendarRange | null>();
  for (const row of db.selectObjects('SELECT * FROM calendar')) {
    const serviceId = asString(row['service_id']) ?? '';
    const start = asString(row['start_date']);
    const end = asString(row['end_date']);
    const days: Record<string, boolean> = {};
    for (const day of WEEKDAYS) days[day] = asNumber(row[day]) === 1;
    ranges.set(serviceId, start === null || end === null ? null : {days, start, end});
  }
  const added = new Set<string>();
  const removed = new Map<string, Set<string>>();
  for (const row of db.selectObjects('SELECT service_id, date, exception_type FROM calendar_dates')) {
    const serviceId = asString(row['service_id']) ?? '';
    if (!ranges.has(serviceId)) ranges.set(serviceId, null);
    const type = asNumber(row['exception_type']);
    if (type === 1) {
      added.add(serviceId);
    } else if (type === 2) {
      const dates = removed.get(serviceId) ?? new Set<string>();
      dates.add(asString(row['date']) ?? '');
      removed.set(serviceId, dates);
    }
  }

  const never: string[] = [];
  for (const [serviceId, range] of ranges) {
    if (added.has(serviceId)) continue;
    if (range !== null && runsOnSomeDate(range, removed.get(serviceId) ?? new Set())) continue;
    never.push(serviceId);
  }
  never.sort();

  for (const serviceId of never) {
    const rows = db.selectObjects(
      'SELECT DISTINCT route_id FROM trips WHERE service_id = ? AND route_id IS NOT NULL ORDER BY route_id',
      [serviceId],
    );
    for (const row of rows) {
      const routeId = asString(row['route_id']) ?? '';
      ctx.emit('service_never_active', {
        routeId,
        details: {serviceId},
        message: `Service ${serviceId} never runs, so route ${routeLabel(routeId)}'s trips that use it never run.`,
      });
    }
  }
}

async function scan(ctx: CheckContext): Promise<void> {
  const names = createNames(ctx.db);
  emitRoutesWithoutTrips(ctx, names.route);
  await ctx.checkpoint();
  emitUnusedStops(ctx, names.stop);
  await ctx.checkpoint();
  emitInactiveServices(ctx, names.route);
  await ctx.checkpoint();
}

/** Routes without trips, stops no trip serves, and services that never run. */
export const coverageCheck: ValidationCheck = {
  ruleIds: ['route_without_trips', 'stop_unused', 'service_never_active'],
  run: scan,
};
