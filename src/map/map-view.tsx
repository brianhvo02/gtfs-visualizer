import {useEffect, useRef, useState, type ReactElement} from 'react';
import type {FeatureCollection} from 'geojson';
import type {FeedApi} from '../db-client/feed-api.ts';
import {MapUnavailableError, type MapAdapter} from './adapter.ts';
import {createMap} from './create-map.ts';
import {
  baseLayers,
  boundsOf,
  CLICK_LAYERS,
  EMPTY_COLLECTION,
  selectionStyle,
  SOURCE_ROUTES,
  SOURCE_STOPS,
} from './layers.ts';

export interface MapViewProps {
  readonly service: FeedApi;
  readonly feedId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedStopId: string | null;
  readonly routeStopIds: readonly string[];
  readonly onSelectRoute: (routeId: string) => void;
  readonly onSelectStop: (stopId: string) => void;
}

interface Hover {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

function mapErrorMessage(error: unknown): string {
  if (error instanceof MapUnavailableError) {
    return error.reason === 'missing_token'
      ? 'The map is unavailable: no Mapbox token is configured. Routes and stops still work in the sidebar.'
      : 'The map is unavailable: the Mapbox token was rejected. Routes and stops still work in the sidebar.';
  }
  return `The map failed to load: ${error instanceof Error ? error.message : String(error)}`;
}

export function MapView({
  service,
  feedId,
  selectedRouteId,
  selectedStopId,
  routeStopIds,
  onSelectRoute,
  onSelectStop,
}: MapViewProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [routes, setRoutes] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let disposed = false;
    let created: MapAdapter | null = null;
    createMap(container).then(
      (map) => {
        if (disposed) {
          map.destroy();
          return;
        }
        created = map;
        map.setSource(SOURCE_ROUTES, EMPTY_COLLECTION);
        map.setSource(SOURCE_STOPS, EMPTY_COLLECTION);
        for (const layer of baseLayers()) map.addLayer(layer);
        setAdapter(map);
      },
      (failure: unknown) => {
        if (!disposed) setError(mapErrorMessage(failure));
      },
    );
    return () => {
      disposed = true;
      created?.destroy();
    };
  }, []);

  useEffect(() => {
    if (adapter === null) return;
    const offClick = adapter.onFeatureClick(CLICK_LAYERS, (feature) => {
      const {stopId, routeId} = feature.properties;
      if (typeof stopId === 'string') {
        onSelectStop(stopId);
      } else if (typeof routeId === 'string') {
        onSelectRoute(routeId);
      }
    });
    const offHover = adapter.onFeatureHover(CLICK_LAYERS, (feature, point) => {
      const name = feature?.properties['name'];
      setHover(typeof name === 'string' ? {name, x: point.x, y: point.y} : null);
    });
    return () => {
      offClick();
      offHover();
    };
  }, [adapter, onSelectRoute, onSelectStop]);

  useEffect(() => {
    if (adapter === null) return;
    if (feedId === null) {
      adapter.setSource(SOURCE_ROUTES, EMPTY_COLLECTION);
      adapter.setSource(SOURCE_STOPS, EMPTY_COLLECTION);
      // Reset derived route data when the feed is cleared (external map sync).
      // oxlint-disable-next-line react/set-state-in-effect
      setRoutes(null);
      return;
    }
    let cancelled = false;
    void Promise.all([service.getRouteShapesGeoJSON(feedId), service.getStopsGeoJSON(feedId)]).then(
      ([routeShapes, stops]) => {
        if (cancelled) return;
        adapter.setSource(SOURCE_ROUTES, routeShapes);
        adapter.setSource(SOURCE_STOPS, stops);
        setRoutes(routeShapes);
        const bounds = boundsOf(routeShapes) ?? boundsOf(stops);
        if (bounds !== null) adapter.fitBounds(bounds);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [adapter, service, feedId]);

  useEffect(() => {
    if (adapter === null) return;
    const style = selectionStyle({routeId: selectedRouteId, stopId: selectedStopId, routeStopIds});
    for (const {layerId, filter} of style.filters) adapter.setFilter(layerId, filter);
    for (const {layerId, opacity} of style.opacity) adapter.setOpacity(layerId, opacity);
  }, [adapter, selectedRouteId, selectedStopId, routeStopIds]);

  useEffect(() => {
    if (adapter === null || routes === null || selectedRouteId === null) return;
    const bounds = boundsOf(routes, (p) => p['routeId'] === selectedRouteId);
    if (bounds !== null) adapter.fitBounds(bounds);
  }, [adapter, routes, selectedRouteId]);

  return (
    <div className="map-area">
      <div ref={containerRef} className="map-container" />
      {error !== null && (
        <p role="status" className="map-notice">
          {error}
        </p>
      )}
      {hover !== null && (
        <div className="map-tooltip" style={{left: hover.x + 12, top: hover.y + 12}}>
          {hover.name}
        </div>
      )}
    </div>
  );
}
