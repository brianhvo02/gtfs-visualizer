import {useCallback, useEffect, useState, useSyncExternalStore, type ReactElement} from 'react';
import type {FeedApi} from './db-client/feed-api.ts';
import {host} from './db-client/host.ts';
import {MapView} from './map/map-view.tsx';
import type {FeedRecord} from './shared/types.ts';
import {useSelection, type Selection, type UpdateSelection} from './state/url-state.ts';
import {ErrorMessage} from './ui/error-message.tsx';
import {FeedInfo} from './ui/feed-info.tsx';
import {FeedPicker} from './ui/feed-picker.tsx';
import {HostNotice} from './ui/host-notice.tsx';
import {RouteDetailView} from './ui/route-detail.tsx';
import {RouteList} from './ui/route-list.tsx';
import {StopDetailView} from './ui/stop-detail.tsx';
import {useAsync} from './ui/use-async.ts';

const CATALOG_BASE_URL = import.meta.env.VITE_CATALOG_BASE_URL || null;

const NO_STOPS: readonly string[] = [];

export function App(): ReactElement {
  const state = useSyncExternalStore(host.subscribe, host.getState);
  useEffect(() => {
    void host.start();
  }, []);
  if (state.kind !== 'ready') {
    return <HostNotice state={state} onTakeOver={() => void host.takeOver()} />;
  }
  // Remount after a worker restart so pending imports on the dead worker don't leave stale UI state.
  return <Explorer key={state.generation} service={state.service} />;
}

function Explorer({service}: {readonly service: FeedApi}): ReactElement {
  const [selection, update] = useSelection();
  const [notice, setNotice] = useState<string | null>(null);
  const [routeStopIds, setRouteStopIds] = useState<readonly string[]>([]);
  const feedId = selection.feed;
  const feed = useAsync(
    async () => (feedId === null ? null : await service.openFeed(feedId)),
    [service, feedId],
  );
  const activeFeed = feed.status === 'ok' && feed.value !== null && feed.value.id === feedId ? feed.value : null;

  useEffect(() => {
    if (feedId !== null && feed.status === 'ok' && feed.value === null) {
      // Reacting to an async lookup result; there is no event to hang this on.
      // oxlint-disable-next-line react/set-state-in-effect
      setNotice(`The feed “${feedId}” isn't saved in this browser. Import it to view it.`);
      update({feed: null}, {replace: true});
    }
  }, [feed, feedId, update]);

  const selectRoute = useCallback((routeId: string) => update({route: routeId, stop: null}), [update]);
  const selectStop = useCallback((stopId: string) => update({stop: stopId}), [update]);
  const openFeed = useCallback(
    (id: string) => {
      setNotice(null);
      update({feed: id});
    },
    [update],
  );

  let content: ReactElement;
  if (feedId === null) {
    content = <FeedPicker service={service} catalogBaseUrl={CATALOG_BASE_URL} onOpen={openFeed} />;
  } else if (feed.status === 'error') {
    content = <ErrorMessage error={feed.error} />;
  } else if (activeFeed === null) {
    content = <p className="muted">Opening feed…</p>;
  } else {
    content = (
      <FeedContent
        service={service}
        feed={activeFeed}
        selection={selection}
        update={update}
        onSelectRoute={selectRoute}
        onSelectStop={selectStop}
        onPatternStops={setRouteStopIds}
      />
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="app-header">
          <h1>GTFS Visualizer</h1>
          {feedId !== null && (
            <button type="button" className="link" onClick={() => update({feed: null})}>
              Change feed
            </button>
          )}
        </header>
        {notice !== null && (
          <div role="status" className="notice">
            {notice}{' '}
            <button type="button" className="link" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {content}
      </aside>
      <MapView
        service={service}
        feedId={activeFeed?.id ?? null}
        selectedRouteId={selection.route}
        selectedStopId={selection.stop}
        routeStopIds={selection.route === null ? NO_STOPS : routeStopIds}
        onSelectRoute={selectRoute}
        onSelectStop={selectStop}
      />
    </div>
  );
}

interface FeedContentProps {
  readonly service: FeedApi;
  readonly feed: FeedRecord;
  readonly selection: Selection;
  readonly update: UpdateSelection;
  readonly onSelectRoute: (routeId: string) => void;
  readonly onSelectStop: (stopId: string) => void;
  readonly onPatternStops: (stopIds: readonly string[]) => void;
}

function FeedContent({
  service,
  feed,
  selection,
  update,
  onSelectRoute,
  onSelectStop,
  onPatternStops,
}: FeedContentProps): ReactElement {
  const summary = useAsync(() => service.getFeedSummary(feed.id, null), [service, feed.id]);
  const routes = useAsync(() => service.getRoutes(feed.id, null), [service, feed.id]);

  if (summary.status === 'loading') return <p className="muted">Loading feed…</p>;
  if (summary.status === 'error') return <ErrorMessage error={summary.error} />;

  if (selection.stop !== null) {
    return (
      <StopDetailView
        service={service}
        feedId={feed.id}
        stopId={selection.stop}
        date={selection.date}
        timezone={summary.value.timezone}
        onBack={() => update({stop: null, date: null})}
        onSelectRoute={onSelectRoute}
        onDateChange={(date) => update({date}, {replace: true})}
      />
    );
  }
  if (selection.route !== null) {
    return (
      <RouteDetailView
        service={service}
        feedId={feed.id}
        routeId={selection.route}
        onBack={() => update({route: null})}
        onSelectStop={onSelectStop}
        onPatternStops={onPatternStops}
      />
    );
  }
  return (
    <>
      <p className="feed-name">{feed.name}</p>
      {routes.status === 'loading' && <p className="muted">Loading routes…</p>}
      {routes.status === 'error' && <ErrorMessage error={routes.error} />}
      {routes.status === 'ok' && <RouteList routes={routes.value} onSelect={onSelectRoute} />}
      <FeedInfo feed={feed} summary={summary.value} />
    </>
  );
}
