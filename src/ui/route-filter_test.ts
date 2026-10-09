import {describe, expect, it} from 'vitest';
import type {RouteSummary} from '../shared/types.ts';
import {categoriesPresent, filterRoutes} from './route-filter.ts';

function route(routeId: string, shortName: string, longName: string, category: RouteSummary['category']): RouteSummary {
  return {
    routeId,
    agencyId: null,
    shortName,
    longName,
    routeType: 3,
    category,
    color: '#000000',
    textColor: '#ffffff',
    sortOrder: null,
  };
}

const ROUTES = [
  route('R10', '10', 'Airport - Central', 'bus'),
  route('R20', '20', 'Central - Furnace Creek', 'bus'),
  route('F1', 'F', 'Harbor Ferry', 'ferry'),
];

describe('route filtering', () => {
  it('matches names and ids case-insensitively', () => {
    expect(filterRoutes(ROUTES, 'central', new Set()).map((r) => r.routeId)).toEqual(['R10', 'R20']);
    expect(filterRoutes(ROUTES, 'f1', new Set()).map((r) => r.routeId)).toEqual(['F1']);
    expect(filterRoutes(ROUTES, '  ', new Set())).toHaveLength(3);
  });
  it('filters by selected categories', () => {
    expect(filterRoutes(ROUTES, '', new Set(['ferry'])).map((r) => r.routeId)).toEqual(['F1']);
  });
  it('lists the categories present in label order', () => {
    expect(categoriesPresent(ROUTES)).toEqual(['bus', 'ferry']);
  });
});
