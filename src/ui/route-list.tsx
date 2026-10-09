import {useMemo, useState, type ReactElement} from 'react';
import {CATEGORY_LABELS, routeLabel, type RouteCategory} from '../gtfs/route-types.ts';
import type {RouteSummary} from '../shared/types.ts';
import {categoriesPresent, filterRoutes} from './route-filter.ts';

export interface RouteListProps {
  readonly routes: readonly RouteSummary[];
  readonly onSelect: (routeId: string) => void;
}

export function RouteList({routes, onSelect}: RouteListProps): ReactElement {
  const [query, setQuery] = useState('');
  const [categories, setCategories] = useState<ReadonlySet<RouteCategory>>(new Set());
  const present = useMemo(() => categoriesPresent(routes), [routes]);
  const visible = useMemo(() => filterRoutes(routes, query, categories), [routes, query, categories]);

  const toggle = (category: RouteCategory): void => {
    setCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  return (
    <section className="panel">
      <h2>Routes</h2>
      <input
        type="search"
        aria-label="Search routes"
        placeholder="Search routes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {present.length > 1 && (
        <div className="chips" role="group" aria-label="Filter by mode">
          {present.map((category) => (
            <button
              key={category}
              type="button"
              className="chip"
              aria-pressed={categories.has(category)}
              onClick={() => toggle(category)}
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>
      )}
      <ul className="route-list">
        {visible.map((route) => (
          <li key={route.routeId}>
            <button type="button" className="route-row" onClick={() => onSelect(route.routeId)}>
              <span
                className="route-badge"
                aria-hidden="true"
                style={{background: route.color, color: route.textColor}}
              >
                {route.shortName ?? route.routeId}
              </span>
              <span>{routeLabel(route)}</span>
            </button>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="muted">No routes match.</p>}
    </section>
  );
}
