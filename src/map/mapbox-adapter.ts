import mapboxgl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
  type PointLike,
} from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type {FeatureCollection} from 'geojson';
import {
  MapUnavailableError,
  type Bounds,
  type LayerFilter,
  type LayerSpec,
  type MapAdapter,
  type MapFeature,
  type PaintValue,
  type ScreenPoint,
} from './adapter.ts';

const STYLE_URL = 'mapbox://styles/mapbox/light-v11';
const CLICK_TOLERANCE_PX = 6;
const MAP_LOAD_TIMEOUT_MS = 30_000;

function toValue(value: PaintValue): string | ExpressionSpecification {
  return typeof value === 'string' ? value : ['get', value.property];
}

function toExpression(filter: LayerFilter): ExpressionSpecification {
  switch (filter.kind) {
    case 'all':
      return ['boolean', true];
    case 'none':
      return ['boolean', false];
    case 'eq':
      return ['==', ['get', filter.property], filter.value];
    case 'in':
      return ['in', ['get', filter.property], ['literal', [...filter.values]]];
  }
}

class MapboxAdapter implements MapAdapter {
  private readonly map: mapboxgl.Map;

  constructor(map: mapboxgl.Map) {
    this.map = map;
  }

  setSource(id: string, data: FeatureCollection): void {
    const source = this.map.getSource<GeoJSONSource>(id);
    if (source === undefined) {
      this.map.addSource(id, {type: 'geojson', data});
    } else {
      source.setData(data);
    }
  }

  addLayer(spec: LayerSpec): void {
    const base = {
      id: spec.id,
      source: spec.source,
      filter: toExpression(spec.filter ?? {kind: 'all'}),
      ...(spec.minZoom === undefined ? {} : {minzoom: spec.minZoom}),
    };
    if (spec.kind === 'line') {
      this.map.addLayer({
        ...base,
        type: 'line',
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {
          'line-color': toValue(spec.paint.color),
          'line-width': spec.paint.width,
          'line-opacity': spec.paint.opacity,
        },
      });
    } else {
      this.map.addLayer({
        ...base,
        type: 'circle',
        paint: {
          'circle-color': toValue(spec.paint.color),
          'circle-radius': spec.paint.radius,
          'circle-stroke-color': spec.paint.strokeColor,
          'circle-stroke-width': spec.paint.strokeWidth,
        },
      });
    }
  }

  removeLayer(id: string): void {
    if (this.map.getLayer(id) !== undefined) this.map.removeLayer(id);
  }

  setFilter(layerId: string, filter: LayerFilter): void {
    this.map.setFilter(layerId, toExpression(filter));
  }

  setOpacity(layerId: string, opacity: number): void {
    const layer = this.map.getLayer(layerId);
    if (layer?.type === 'line') this.map.setPaintProperty(layerId, 'line-opacity', opacity);
    if (layer?.type === 'circle') this.map.setPaintProperty(layerId, 'circle-opacity', opacity);
  }

  fitBounds(bounds: Bounds): void {
    this.map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {padding: 48, maxZoom: 15, duration: 600},
    );
  }

  onFeatureClick(layerIds: readonly string[], handler: (feature: MapFeature) => void): () => void {
    const listener = (event: MapMouseEvent): void => {
      const feature = this.pick(event.point, layerIds);
      if (feature !== null) handler(feature);
    };
    this.map.on('click', listener);
    return () => {
      this.map.off('click', listener);
    };
  }

  onFeatureHover(
    layerIds: readonly string[],
    handler: (feature: MapFeature | null, point: ScreenPoint) => void,
  ): () => void {
    const move = (event: MapMouseEvent): void => {
      const feature = this.pick(event.point, layerIds);
      this.map.getCanvas().style.cursor = feature === null ? '' : 'pointer';
      handler(feature, {x: event.point.x, y: event.point.y});
    };
    const out = (): void => handler(null, {x: 0, y: 0});
    this.map.on('mousemove', move);
    this.map.on('mouseout', out);
    return () => {
      this.map.off('mousemove', move);
      this.map.off('mouseout', out);
    };
  }

  destroy(): void {
    this.map.remove();
  }

  private pick(point: ScreenPoint, layerIds: readonly string[]): MapFeature | null {
    const box: [PointLike, PointLike] = [
      [point.x - CLICK_TOLERANCE_PX, point.y - CLICK_TOLERANCE_PX],
      [point.x + CLICK_TOLERANCE_PX, point.y + CLICK_TOLERANCE_PX],
    ];
    const existing = layerIds.filter((id) => this.map.getLayer(id) !== undefined);
    const features = this.map.queryRenderedFeatures(box, {layers: existing});
    for (const layerId of layerIds) {
      const feature = features.find((f) => f.layer?.id === layerId);
      if (feature !== undefined) return {layerId, properties: feature.properties ?? {}};
    }
    return null;
  }
}

/** Resolves once the style has loaded; rejects if Mapbox refuses the token or loading stalls. */
export function createMapboxAdapter(container: HTMLElement, token: string): Promise<MapAdapter> {
  mapboxgl.accessToken = token;
  const map = new mapboxgl.Map({container, style: STYLE_URL, center: [-98, 39], zoom: 3});
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      map.remove();
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error('The map took too long to load.'));
    }, MAP_LOAD_TIMEOUT_MS);
    map.on('error', (event) => {
      const error: unknown = event.error;
      const status =
        typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      if (status === 401 || status === 403) fail(new MapUnavailableError('invalid_token'));
    });
    map.on('load', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(new MapboxAdapter(map));
    });
  });
}
