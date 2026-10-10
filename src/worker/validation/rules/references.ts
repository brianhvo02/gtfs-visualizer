import {asNumber, asString} from '../../sql-values.ts';
import {createNames} from '../names.ts';
import type {CheckContext, ValidationCheck} from '../runner.ts';

const LOCATION_STATION = 1;
const LOCATION_BOARDING_AREA = 4;

async function checkTrips(ctx: CheckContext): Promise<void> {
  const {db} = ctx;
  const unknownRoutes = db.selectObjects(
    `SELECT t.trip_id, t.route_id FROM trips t
     WHERE NOT EXISTS (SELECT 1 FROM routes r WHERE r.route_id = t.route_id)
     ORDER BY t.trip_id`,
  );
  for (const row of unknownRoutes) {
    const tripId = asString(row['trip_id']) ?? '';
    const routeId = asString(row['route_id']) ?? '';
    ctx.emit('trip_unknown_route', {
      tripId,
      message: `Trip ${tripId} refers to route ${routeId}, which isn't in routes.txt.`,
    });
  }
  await ctx.checkpoint();

  const unknownServices = db.selectObjects(
    `SELECT t.trip_id, t.route_id, t.service_id FROM trips t
     WHERE NOT EXISTS (SELECT 1 FROM calendar c WHERE c.service_id = t.service_id)
       AND NOT EXISTS (SELECT 1 FROM calendar_dates d WHERE d.service_id = t.service_id)
     ORDER BY t.trip_id`,
  );
  for (const row of unknownServices) {
    const tripId = asString(row['trip_id']) ?? '';
    const serviceId = asString(row['service_id']) ?? '';
    ctx.emit('trip_unknown_service', {
      routeId: asString(row['route_id']),
      tripId,
      message: `Trip ${tripId} uses service ${serviceId}, which isn't in calendar.txt or calendar_dates.txt, so it never runs.`,
    });
  }
  await ctx.checkpoint();

  const unknownShapes = db.selectObjects(
    `SELECT t.trip_id, t.route_id, t.shape_id FROM trips t
     WHERE t.shape_id IS NOT NULL AND t.shape_id <> ''
       AND NOT EXISTS (SELECT 1 FROM shapes s WHERE s.shape_id = t.shape_id)
     ORDER BY t.trip_id`,
  );
  for (const row of unknownShapes) {
    const tripId = asString(row['trip_id']) ?? '';
    const shapeId = asString(row['shape_id']) ?? '';
    ctx.emit('trip_unknown_shape', {
      routeId: asString(row['route_id']),
      tripId,
      message: `Trip ${tripId} uses shape ${shapeId}, which has no points in shapes.txt; its line is drawn from stop positions.`,
    });
  }
  await ctx.checkpoint();
}

async function checkParents(ctx: CheckContext): Promise<void> {
  const names = createNames(ctx.db);
  const rows = ctx.db.selectObjects(
    `SELECT s.stop_id, s.location_type, s.parent_station,
            p.stop_id AS parent_found, p.location_type AS parent_type
     FROM stops s LEFT JOIN stops p ON p.stop_id = s.parent_station
     WHERE s.parent_station IS NOT NULL AND s.parent_station <> ''
     ORDER BY s.stop_id`,
  );
  for (const row of rows) {
    const stopId = asString(row['stop_id']) ?? '';
    const parentId = asString(row['parent_station']) ?? '';
    const type = asNumber(row['location_type']) ?? 0;
    const prefix = `${names.stop(stopId)} has parent station ${parentId}, which`;
    if (asString(row['parent_found']) === null) {
      ctx.emit('stop_unknown_parent', {stopId, message: `${prefix} isn't in stops.txt.`});
      continue;
    }
    const parentType = asNumber(row['parent_type']) ?? 0;
    if (type === LOCATION_BOARDING_AREA) {
      if (parentType !== 0) ctx.emit('stop_unknown_parent', {stopId, message: `${prefix} isn't a platform.`});
    } else if (parentType !== LOCATION_STATION) {
      ctx.emit('stop_unknown_parent', {stopId, message: `${prefix} isn't a station.`});
    }
  }
  await ctx.checkpoint();
}

/** Trips and stops that point at rows that don't exist. */
export const referencesCheck: ValidationCheck = {
  ruleIds: ['trip_unknown_route', 'trip_unknown_service', 'trip_unknown_shape', 'stop_unknown_parent'],
  async run(ctx) {
    await checkTrips(ctx);
    await checkParents(ctx);
  },
};
