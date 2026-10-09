import type {FeatureCollection} from 'geojson';
import {describe, expect, it} from 'vitest';
import {matchesFilter} from './adapter.ts';
import {baseLayers, boundsOf, CLICK_LAYERS, LAYER, selectionStyle} from './layers.ts';

const LINES: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {routeId: 'A'},
      geometry: {type: 'LineString', coordinates: [[-122, 37], [-121, 38]]},
    },
    {
      type: 'Feature',
      properties: {routeId: 'B'},
      geometry: {type: 'LineString', coordinates: [[-120, 36], [-119.5, 36.5]]},
    },
  ],
};

describe('layers', () => {
  it('defines every layer once, and every clickable layer exists', () => {
    const ids = baseLayers().map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of CLICK_LAYERS) expect(ids).toContain(id);
  });

  it('hides highlights and shows full-opacity routes with nothing selected', () => {
    expect(selectionStyle({routeId: null, stopId: null, routeStopIds: []})).toEqual({
      filters: [
        {layerId: LAYER.routeHighlight, filter: {kind: 'none'}},
        {layerId: LAYER.routeStops, filter: {kind: 'none'}},
        {layerId: LAYER.stopHighlight, filter: {kind: 'none'}},
      ],
      opacity: [{layerId: LAYER.routes, opacity: 0.9}],
    });
  });

  it('highlights the selected route, its stops, and the selected stop', () => {
    expect(selectionStyle({routeId: 'A', stopId: 'S2', routeStopIds: ['S1', 'S2']})).toEqual({
      filters: [
        {layerId: LAYER.routeHighlight, filter: {kind: 'eq', property: 'routeId', value: 'A'}},
        {layerId: LAYER.routeStops, filter: {kind: 'in', property: 'stopId', values: ['S1', 'S2']}},
        {layerId: LAYER.stopHighlight, filter: {kind: 'eq', property: 'stopId', value: 'S2'}},
      ],
      opacity: [{layerId: LAYER.routes, opacity: 0.25}],
    });
  });

  it('computes bounds, optionally for a subset', () => {
    expect(boundsOf(LINES)).toEqual([-122, 36, -119.5, 38]);
    expect(boundsOf(LINES, (p) => p['routeId'] === 'B')).toEqual([-120, 36, -119.5, 36.5]);
    expect(boundsOf(LINES, () => false)).toBeNull();
  });

  it('evaluates filters', () => {
    expect(matchesFilter({kind: 'all'}, {})).toBe(true);
    expect(matchesFilter({kind: 'none'}, {})).toBe(false);
    expect(matchesFilter({kind: 'eq', property: 'a', value: 'x'}, {a: 'x'})).toBe(true);
    expect(matchesFilter({kind: 'in', property: 'a', values: ['y']}, {a: 'x'})).toBe(false);
  });
});
