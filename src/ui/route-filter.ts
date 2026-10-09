import {CATEGORY_LABELS, routeLabel, type RouteCategory} from '../gtfs/route-types.ts';
import type {RouteSummary} from '../shared/types.ts';

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

export function filterRoutes(
  routes: readonly RouteSummary[],
  query: string,
  categories: ReadonlySet<RouteCategory>,
): RouteSummary[] {
  const needle = query.trim().toLowerCase();
  return routes.filter((route) => {
    if (categories.size > 0 && !categories.has(route.category)) return false;
    if (needle.length === 0) return true;
    return `${routeLabel(route)} ${route.routeId}`.toLowerCase().includes(needle);
  });
}

export function categoriesPresent(routes: readonly RouteSummary[]): RouteCategory[] {
  const present = new Set(routes.map((route) => route.category));
  return [...present].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
}
