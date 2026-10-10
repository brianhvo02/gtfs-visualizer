import {useCallback, useEffect, useState, useSyncExternalStore, type ReactElement} from 'react';
import type {FeedApi} from './db-client/feed-api.ts';
import {host} from './db-client/host.ts';
import {MapView} from './map/map-view.tsx';
import type {FeedLanguages, FeedRecord} from './shared/types.ts';
import {ORIGINAL_LANGUAGE, resolveLanguage, type ResolvedLanguage} from './state/resolve-language.ts';
import {useSelection, type Selection, type UpdateSelection} from './state/url-state.ts';
import {ErrorMessage} from './ui/error-message.tsx';
import {FeedInfo} from './ui/feed-info.tsx';
import {FeedPicker} from './ui/feed-picker.tsx';
import {feedDisplayName} from './ui/format.ts';
import {HostNotice} from './ui/host-notice.tsx';
import {LanguageSelect} from './ui/language-select.tsx';
import {RouteDetailView} from './ui/route-detail.tsx';
import {RouteList} from './ui/route-list.tsx';
import {StopDetailView} from './ui/stop-detail.tsx';
import {useAsync} from './ui/use-async.ts';


const NO_STOPS: readonly string[] = [];
const NO_LANGUAGE: ResolvedLanguage = {display: null, query: null};

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
  const activeFeedId = activeFeed?.id ?? null;
  const languages = useAsync(
    async () => (activeFeedId === null ? null : await service.getFeedLanguages(activeFeedId)),
    [service, activeFeedId],
  );
  const feedLanguages: FeedLanguages | null = languages.status === 'ok' ? languages.value : null;
  const resolved: ResolvedLanguage | null =
    feedLanguages === null ? null : resolveLanguage(selection.lang, navigator.languages, feedLanguages);

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
    content = <FeedPicker service={service} onOpen={openFeed} />;
  } else if (feed.status === 'error') {
    content = <ErrorMessage error={feed.error} />;
  } else if (languages.status === 'error') {
    content = <ErrorMessage error={languages.error} />;
  } else if (activeFeed === null || resolved === null) {
    content = <p className="muted">Opening feed…</p>;
  } else {
    content = (
      <FeedContent
        service={service}
        feed={activeFeed}
        selection={selection}
        lang={resolved.query}
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
          {feedLanguages !== null && (
            <LanguageSelect
              languages={feedLanguages}
              value={resolved?.query ?? ORIGINAL_LANGUAGE}
              onChange={(lang) => update({lang}, {replace: true})}
            />
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
        language={activeFeed === null ? NO_LANGUAGE : resolved}
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
  readonly lang: string | null;
  readonly update: UpdateSelection;
  readonly onSelectRoute: (routeId: string) => void;
  readonly onSelectStop: (stopId: string) => void;
  readonly onPatternStops: (stopIds: readonly string[]) => void;
}

function FeedContent({
  service,
  feed,
  selection,
  lang,
  update,
  onSelectRoute,
  onSelectStop,
  onPatternStops,
}: FeedContentProps): ReactElement {
  // The gate (time zone) is language-independent, so changing language never unmounts the detail views.
  const base = useAsync(() => service.getFeedSummary(feed.id, null), [service, feed.id]);
  const summary = useAsync(() => service.getFeedSummary(feed.id, lang), [service, feed.id, lang]);
  const routes = useAsync(() => service.getRoutes(feed.id, lang), [service, feed.id, lang]);

  if (base.status === 'loading') return <p className="muted">Loading feed…</p>;
  if (base.status === 'error') return <ErrorMessage error={base.error} />;

  if (selection.stop !== null) {
    return (
      <StopDetailView
        service={service}
        feedId={feed.id}
        lang={lang}
        stopId={selection.stop}
        date={selection.date}
        timezone={base.value.timezone}
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
        lang={lang}
        routeId={selection.route}
        onBack={() => update({route: null})}
        onSelectStop={onSelectStop}
        onPatternStops={onPatternStops}
      />
    );
  }
  return (
    <>
      <p className="feed-name">
        {feedDisplayName(
          feed.name,
          base.value.agencies[0]?.name,
          summary.status === 'ok' ? summary.value.agencies[0]?.name : undefined,
        )}
      </p>
      {routes.status === 'loading' && <p className="muted">Loading routes…</p>}
      {routes.status === 'error' && <ErrorMessage error={routes.error} />}
      {routes.status === 'ok' && <RouteList routes={routes.value} onSelect={onSelectRoute} />}
      {summary.status === 'loading' && <p className="muted">Loading feed details…</p>}
      {summary.status === 'error' && <ErrorMessage error={summary.error} />}
      {summary.status === 'ok' && <FeedInfo feed={feed} summary={summary.value} />}
    </>
  );
}
