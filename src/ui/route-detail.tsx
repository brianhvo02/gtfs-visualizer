import {useEffect, useState, type ReactElement} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import {routeLabel} from '../gtfs/route-types.ts';
import {ErrorMessage} from './error-message.tsx';
import {useAsync} from './use-async.ts';

export interface RouteDetailViewProps {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly routeId: string;
  readonly lang: string | null;
  readonly onBack: () => void;
  readonly onSelectStop: (stopId: string) => void;
  /**
   * Reports the stops of the displayed pattern so the map can show them.
   * Must be referentially stable (e.g. a state setter); it is an effect dependency.
   */
  readonly onPatternStops: (stopIds: readonly string[]) => void;
}

export function RouteDetailView({
  service,
  feedId,
  routeId,
  lang,
  onBack,
  onSelectStop,
  onPatternStops,
}: RouteDetailViewProps): ReactElement {
  const state = useAsync(() => service.getRouteDetail(feedId, routeId, lang), [service, feedId, routeId, lang]);
  const [patternId, setPatternId] = useState<string | null>(null);
  const detail = state.status === 'ok' ? state.value : null;
  const pattern =
    detail?.patterns.find((p) => p.patternId === patternId) ?? detail?.patterns[0] ?? null;

  useEffect(() => {
    onPatternStops(pattern === null ? [] : pattern.stops.map((stop) => stop.stopId));
  }, [pattern, onPatternStops]);

  const back = (
    <button type="button" className="link" onClick={onBack}>
      ← All routes
    </button>
  );
  if (state.status === 'loading') return <p className="muted">Loading route…</p>;
  if (state.status === 'error') return <ErrorMessage error={state.error} />;
  if (detail === null) {
    return (
      <section className="panel">
        {back}
        <p role="status">Route not found in this feed.</p>
      </section>
    );
  }
  const {route} = detail;
  return (
    <section className="panel">
      {back}
      <h2>
        <span className="route-badge" aria-hidden="true" style={{background: route.color, color: route.textColor}}>
          {route.shortName ?? route.routeId}
        </span>{' '}
        {routeLabel(route)}
      </h2>
      {detail.patterns.length > 1 && (
        <label className="field">
          Pattern
          <select value={pattern?.patternId ?? ''} onChange={(event) => setPatternId(event.target.value)}>
            {detail.patterns.map((p) => (
              <option key={p.patternId} value={p.patternId}>
                {`Direction ${p.directionId} · ${p.headsign ?? 'No headsign'} · ${p.tripCount} trips`}
              </option>
            ))}
          </select>
        </label>
      )}
      {pattern === null ? (
        <p className="muted">This route has no trips.</p>
      ) : (
        <ol className="stop-list">
          {pattern.stops.map((stop, index) => (
            <li key={`${stop.stopId}-${index}`}>
              <button type="button" className="link" onClick={() => onSelectStop(stop.stopId)}>
                {stop.name}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
