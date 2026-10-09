import type {FeatureCollection, Position} from 'geojson';
import type {Bounds, LayerFilter, LayerSpec} from './adapter.ts';

export const SOURCE_ROUTES = 'routes';
export const SOURCE_STOPS = 'stops';

export const LAYER = {
  routes: 'routes-line',
  routeHighlight: 'routes-highlight',
  stops: 'stops-circle',
  routeStops: 'stops-route',
  stopHighlight: 'stop-highlight',
} as const;

/** Click priority: the most specific feature under the cursor wins. */
export const CLICK_LAYERS: readonly string[] = [
  LAYER.stopHighlight,
  LAYER.routeStops,
  LAYER.stops,
  LAYER.routeHighlight,
  LAYER.routes,
];

export const EMPTY_COLLECTION: FeatureCollection = {type: 'FeatureCollection', features: []};

const NONE: LayerFilter = {kind: 'none'};
const STOPS_MIN_ZOOM = 13;
const DIMMED_OPACITY = 0.25;
const NORMAL_OPACITY = 0.9;

export function baseLayers(): LayerSpec[] {
  return [
    {
      kind: 'line',
      id: LAYER.routes,
      source: SOURCE_ROUTES,
      paint: {color: {property: 'color'}, width: 2.5, opacity: NORMAL_OPACITY},
    },
    {
      kind: 'line',
      id: LAYER.routeHighlight,
      source: SOURCE_ROUTES,
      filter: NONE,
      paint: {color: {property: 'color'}, width: 6, opacity: 1},
    },
    {
      kind: 'circle',
      id: LAYER.stops,
      source: SOURCE_STOPS,
      minZoom: STOPS_MIN_ZOOM,
      paint: {color: '#ffffff', radius: 3.5, strokeColor: '#334155', strokeWidth: 1},
    },
    {
      kind: 'circle',
      id: LAYER.routeStops,
      source: SOURCE_STOPS,
      filter: NONE,
      paint: {color: '#ffffff', radius: 4.5, strokeColor: '#0f172a', strokeWidth: 1.5},
    },
    {
      kind: 'circle',
      id: LAYER.stopHighlight,
      source: SOURCE_STOPS,
      filter: NONE,
      paint: {color: '#facc15', radius: 8, strokeColor: '#0f172a', strokeWidth: 2},
    },
  ];
}

export interface SelectionStyleInput {
  readonly routeId: string | null;
  readonly stopId: string | null;
  readonly routeStopIds: readonly string[];
}

export interface SelectionStyle {
  readonly filters: ReadonlyArray<{readonly layerId: string; readonly filter: LayerFilter}>;
  readonly opacity: ReadonlyArray<{readonly layerId: string; readonly opacity: number}>;
}

export function selectionStyle(input: SelectionStyleInput): SelectionStyle {
  return {
    filters: [
      {
        layerId: LAYER.routeHighlight,
        filter: input.routeId === null ? NONE : {kind: 'eq', property: 'routeId', value: input.routeId},
      },
      {
        layerId: LAYER.routeStops,
        filter:
          input.routeStopIds.length === 0
            ? NONE
            : {kind: 'in', property: 'stopId', values: input.routeStopIds},
      },
      {
        layerId: LAYER.stopHighlight,
        filter: input.stopId === null ? NONE : {kind: 'eq', property: 'stopId', value: input.stopId},
      },
    ],
    opacity: [{layerId: LAYER.routes, opacity: input.routeId === null ? NORMAL_OPACITY : DIMMED_OPACITY}],
  };
}

export function boundsOf(
  collection: FeatureCollection,
  include: (properties: Readonly<Record<string, unknown>>) => boolean = () => true,
): Bounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const extend = (position: Position): void => {
    const [lon, lat] = position;
    if (lon === undefined || lat === undefined) return;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  };
  for (const feature of collection.features) {
    if (!include(feature.properties ?? {})) continue;
    const geometry = feature.geometry;
    if (geometry.type === 'Point') extend(geometry.coordinates);
    if (geometry.type === 'LineString') geometry.coordinates.forEach(extend);
  }
  return Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}
