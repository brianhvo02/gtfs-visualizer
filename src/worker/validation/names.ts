import type {Database} from '../sqlite.ts';
import {asString} from '../sql-values.ts';

export interface Names {
  /** `stop_name`, or the id when the stop is unknown or unnamed. */
  stop(id: string): string;
  /** `route_short_name`, else `route_long_name`, else the id. */
  route(id: string): string;
  /** Releases the prepared statements; the lookups must not be used afterwards. */
  finalize(): void;
}

/** Lazy, cached name lookups for use in issue messages. */
export function createNames(db: Database): Names {
  const stopQuery = db.prepare('SELECT stop_name FROM stops WHERE stop_id = ? LIMIT 1');
  const routeQuery = db.prepare('SELECT route_short_name, route_long_name FROM routes WHERE route_id = ? LIMIT 1');
  const stops = new Map<string, string>();
  const routes = new Map<string, string>();
  return {
    stop(id: string): string {
      const cached = stops.get(id);
      if (cached !== undefined) return cached;
      let name = id;
      stopQuery.bind([id]);
      if (stopQuery.step()) name = asString(stopQuery.get({})['stop_name']) ?? id;
      stopQuery.reset();
      stops.set(id, name);
      return name;
    },
    finalize(): void {
      stopQuery.finalize();
      routeQuery.finalize();
    },
    route(id: string): string {
      const cached = routes.get(id);
      if (cached !== undefined) return cached;
      let name = id;
      routeQuery.bind([id]);
      if (routeQuery.step()) {
        const row = routeQuery.get({});
        name = asString(row['route_short_name']) ?? asString(row['route_long_name']) ?? id;
      }
      routeQuery.reset();
      routes.set(id, name);
      return name;
    },
  };
}
