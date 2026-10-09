import {useMemo, type ReactElement} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import {routeLabel} from '../gtfs/route-types.ts';
import {fromIsoDate, todayInTimeZone, toIsoDate} from '../gtfs/time.ts';
import {ErrorMessage} from './error-message.tsx';
import {formatDeparture} from './format.ts';
import {useAsync} from './use-async.ts';

export interface StopDetailViewProps {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly stopId: string;
  /** YYYYMMDD from the URL, or null for today in the feed's time zone. */
  readonly date: string | null;
  readonly timezone: string | null;
  readonly onBack: () => void;
  readonly onSelectRoute: (routeId: string) => void;
  readonly onDateChange: (date: string) => void;
}

export function StopDetailView({
  service,
  feedId,
  stopId,
  date,
  timezone,
  onBack,
  onSelectRoute,
  onDateChange,
}: StopDetailViewProps): ReactElement {
  // Computed once per time zone so the default date does not change on re-render.
  // Reading the clock here is intentional: "today" is sampled per mount and time zone.
  // oxlint-disable-next-line react/purity
  const today = useMemo(() => todayInTimeZone(timezone, new Date()), [timezone]);
  const serviceDate = date ?? today;
  const detail = useAsync(() => service.getStopDetail(feedId, stopId), [service, feedId, stopId]);
  const departures = useAsync(
    () => service.getStopDepartures(feedId, stopId, serviceDate),
    [service, feedId, stopId, serviceDate],
  );
  const back = (
    <button type="button" className="link" onClick={onBack}>
      ← Back
    </button>
  );

  if (detail.status === 'loading') return <p className="muted">Loading stop…</p>;
  if (detail.status === 'error') return <ErrorMessage error={detail.error} />;
  if (detail.value === null) {
    return (
      <section className="panel">
        {back}
        <p role="status">Stop not found in this feed.</p>
      </section>
    );
  }
  const {stop, routes} = detail.value;
  return (
    <section className="panel">
      {back}
      <h2>{stop.name}</h2>
      {stop.code !== null && <p className="muted">Stop code {stop.code}</p>}
      <div className="chips" aria-label="Routes serving this stop">
        {routes.map((route) => (
          <button
            key={route.routeId}
            type="button"
            className="route-badge"
            style={{background: route.color, color: route.textColor}}
            aria-label={routeLabel(route)}
            onClick={() => onSelectRoute(route.routeId)}
          >
            {route.shortName ?? route.routeId}
          </button>
        ))}
      </div>
      <label className="field">
        Service date
        <input
          type="date"
          value={toIsoDate(serviceDate)}
          onChange={(event) => {
            const next = fromIsoDate(event.target.value);
            if (next !== null) onDateChange(next);
          }}
        />
      </label>
      {departures.status === 'loading' && <p className="muted">Loading departures…</p>}
      {departures.status === 'error' && <ErrorMessage error={departures.error} />}
      {departures.status === 'ok' && departures.value.length === 0 && (
        <p className="muted">No departures on this date.</p>
      )}
      {departures.status === 'ok' && departures.value.length > 0 && (
        <table className="departures" aria-label="Departures">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Route</th>
              <th scope="col">To</th>
            </tr>
          </thead>
          <tbody>
            {departures.value.map((departure) => {
              const {clock, nextDay} = formatDeparture(departure.departureSecs);
              return (
                <tr key={`${departure.tripId}-${departure.stopId}-${departure.departureSecs}`}>
                  <td>{nextDay ? `${clock} +1` : clock}</td>
                  <td>
                    <span
                      className="route-badge"
                      style={{background: departure.routeColor, color: departure.routeTextColor}}
                    >
                      {departure.routeShortName ?? departure.routeId}
                    </span>
                  </td>
                  <td>{departure.headsign ?? departure.routeLongName ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
