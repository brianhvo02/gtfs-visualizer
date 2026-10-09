import type {FeatureCollection} from 'geojson';

export type Bounds = readonly [number, number, number, number];

export type PaintValue = string | {readonly property: string};

export type LayerFilter =
  | {readonly kind: 'all'}
  | {readonly kind: 'none'}
  | {readonly kind: 'eq'; readonly property: string; readonly value: string}
  | {readonly kind: 'in'; readonly property: string; readonly values: readonly string[]};

interface LayerBase {
  readonly id: string;
  readonly source: string;
  readonly minZoom?: number;
  readonly filter?: LayerFilter;
}

export interface LineLayerSpec extends LayerBase {
  readonly kind: 'line';
  readonly paint: {readonly color: PaintValue; readonly width: number; readonly opacity: number};
}

export interface CircleLayerSpec extends LayerBase {
  readonly kind: 'circle';
  readonly paint: {
    readonly color: PaintValue;
    readonly radius: number;
    readonly strokeColor: string;
    readonly strokeWidth: number;
  };
}

export type LayerSpec = LineLayerSpec | CircleLayerSpec;

export interface MapFeature {
  readonly layerId: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Provider-neutral map surface. Only map implementations import a map library. */
export interface MapAdapter {
  setSource(id: string, data: FeatureCollection): void;
  addLayer(spec: LayerSpec): void;
  removeLayer(id: string): void;
  setFilter(layerId: string, filter: LayerFilter): void;
  setOpacity(layerId: string, opacity: number): void;
  fitBounds(bounds: Bounds): void;
  onFeatureClick(layerIds: readonly string[], handler: (feature: MapFeature) => void): () => void;
  onFeatureHover(
    layerIds: readonly string[],
    handler: (feature: MapFeature | null, point: ScreenPoint) => void,
  ): () => void;
  destroy(): void;
}

export type MapUnavailableReason = 'missing_token' | 'invalid_token';

export class MapUnavailableError extends Error {
  readonly reason: MapUnavailableReason;

  constructor(reason: MapUnavailableReason) {
    super(
      reason === 'missing_token'
        ? 'No Mapbox access token is configured.'
        : 'The Mapbox access token was rejected.',
    );
    this.name = 'MapUnavailableError';
    this.reason = reason;
  }
}

export function matchesFilter(
  filter: LayerFilter,
  properties: Readonly<Record<string, unknown>>,
): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'none':
      return false;
    case 'eq':
      return properties[filter.property] === filter.value;
    case 'in': {
      const value = properties[filter.property];
      return typeof value === 'string' && filter.values.includes(value);
    }
  }
}
