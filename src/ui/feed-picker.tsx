import {useEffect, useMemo, useState, type ReactElement} from 'react';
import type {CatalogEntry} from '../catalog/catalog-types.ts';
import {loadCatalog} from '../catalog/catalog.ts';
import {fetchFeedSize} from '../catalog/feed-size.ts';
import {forgetKey, getKey} from '../catalog/key-store.ts';
import {searchCatalog} from '../catalog/search.ts';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {FeedRecord, ImportFailure, ImportSource} from '../shared/types.ts';
import {CatalogRow} from './catalog-row.tsx';
import {describeProgress, formatServiceDate} from './format.ts';
import {useAsync} from './use-async.ts';
import {useImport} from './use-import.ts';
import {useUpdateChecks} from './use-update-checks.ts';

export interface FeedPickerProps {
  readonly service: FeedApi;
  readonly onOpen: (feedId: string) => void;
}

function ImportFailureView({failure}: {readonly failure: ImportFailure}): ReactElement {
  return (
    <div role="alert" className="error">
      <p>{failure.code === 'fatal_issues' ? "This feed couldn't be imported:" : failure.message}</p>
      {failure.issues.length > 0 && (
        <ul>
          {failure.issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FeedPicker({service, onOpen}: FeedPickerProps): ReactElement {
  const [version, setVersion] = useState(0);
  const [url, setUrl] = useState('');
  const feeds = useAsync(() => service.listFeeds(), [service, version]);
  const catalog = useAsync(() => loadCatalog(), []);
  const importer = useImport(service);
  const saved = useMemo(() => (feeds.status === 'ok' ? feeds.value : []), [feeds]);
  const entries = useMemo(() => (catalog.status === 'ok' ? catalog.value.entries : []), [catalog]);
  const featured = useMemo(() => entries.filter((entry) => entry.featured), [entries]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [officialOnly, setOfficialOnly] = useState(false);
  const [keysVersion, setKeysVersion] = useState(0);
  const [attempted, setAttempted] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(timer);
  }, [query]);
  // Featured entries are always listed above, so search only the rest and the counts match the rows shown.
  const unfeatured = useMemo(
    () => entries.filter((entry) => !entry.featured && (!officialOnly || entry.official)),
    [entries, officialOnly],
  );
  const search = useMemo(() => searchCatalog(unfeatured, debounced), [unfeatured, debounced]);
  const searching = debounced.trim() !== '';
  const updates = useUpdateChecks(saved, catalog.status === 'ok' ? entries : null);

  const row = (entry: CatalogEntry): ReactElement => (
    <CatalogRow
      key={entry.id}
      entry={entry}
      busy={importer.running}
      failure={attempted === entry.id ? importer.failure : null}
      keysVersion={keysVersion}
      onKeysChanged={() => setKeysVersion((n) => n + 1)}
      onImport={(source) => void start(source, source.kind === 'catalog-file' ? source.file.size : null)}
    />
  );

  const start = async (source: ImportSource, sizeHint: number | null): Promise<void> => {
    setAttempted(source.kind === 'catalog' || source.kind === 'catalog-file' ? source.entry.id : null);
    // Catalog downloads have no size up front; ask the provider so the storage warning still applies.
    const size = sizeHint ?? (source.kind === 'catalog' ? await fetchFeedSize(source.entry, source.key) : null);
    const feed = await importer.run(source, size);
    if (feed === null && source.kind === 'catalog' && source.entry.access.kind === 'key' && importer.failureRef.current?.code === 'key_rejected') {
      forgetKey(source.entry.access.provider);
      setKeysVersion((n) => n + 1);
    }
    setVersion((v) => v + 1);
    if (feed !== null) onOpen(feed.id);
  };

  const canReimport = (feed: FeedRecord): boolean => {
    if (feed.sourceKind === 'file') return false;
    if (feed.sourceKind === 'url') return true;
    const entry = entries.find((candidate) => candidate.id === feed.sourceRef);
    if (entry === undefined || entry.access.kind === 'download') return false;
    return entry.access.kind !== 'key' || (keysVersion >= 0 && getKey(entry.access.provider) !== null);
  };

  const reimport = async (feed: FeedRecord): Promise<void> => {
    if (feed.sourceKind === 'url') {
      await start({kind: 'url', url: feed.sourceRef}, null);
      return;
    }
    const entry = entries.find((candidate) => candidate.id === feed.sourceRef);
    if (entry === undefined || entry.access.kind === 'download') return;
    const key = entry.access.kind === 'key' ? getKey(entry.access.provider) : null;
    if (entry.access.kind === 'key' && key === null) return;
    await start({kind: 'catalog', entry, key}, null);
  };

  const remove = async (feed: FeedRecord): Promise<void> => {
    if (!window.confirm(`Delete ${feed.name} from this browser?`)) return;
    await service.deleteFeed(feed.id);
    setVersion((v) => v + 1);
  };

  return (
    <section className="panel">
      <h2>Choose a feed</h2>
      {importer.running && (
        <p role="status" className="progress">
          {importer.progress === null ? 'Starting import…' : describeProgress(importer.progress)}
        </p>
      )}
      {importer.failure !== null && <ImportFailureView failure={importer.failure} />}

      <h3>Your feeds</h3>
      {saved.length === 0 ? (
        <p className="muted">No feeds imported yet.</p>
      ) : (
        <ul className="feed-list">
          {saved.map((feed) => {
            return (
              <li key={feed.id}>
                <button
                  type="button"
                  className="feed-open"
                  disabled={importer.running}
                  onClick={() => onOpen(feed.id)}
                >
                  {feed.name}
                </button>
                <span className="muted">
                  {formatServiceDate(feed.serviceStart)} – {formatServiceDate(feed.serviceEnd)}
                </span>
                {updates.has(feed.id) && <span className="badge">Update available</span>}
                <span className="row-actions">
                  {canReimport(feed) && (
                    <button
                      type="button"
                      disabled={importer.running}
                      aria-label={`Re-import ${feed.name}`}
                      onClick={() => void reimport(feed)}
                    >
                      Re-import
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={importer.running}
                    aria-label={`Delete ${feed.name}`}
                    onClick={() => void remove(feed)}
                  >
                    Delete
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <h3>Featured</h3>
      {catalog.status === 'loading' && <p className="muted">Loading catalog…</p>}
      {catalog.status === 'error' && <p className="muted">The catalog is unavailable right now.</p>}
      {catalog.status === 'ok' && (
        <>
          <ul className="feed-list">{featured.map(row)}</ul>
          <input
            type="search"
            aria-label="Search feeds"
            placeholder="Search all feeds by name or place"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="checkbox-label">
            <input type="checkbox" checked={officialOnly} onChange={(event) => setOfficialOnly(event.target.checked)} />
            Official feeds only
          </label>
          <p className="muted disclaimer">
            Search covers feeds listed by the{' '}
            <a href="https://mobilitydatabase.org" target="_blank" rel="noreferrer">
              Mobility Database
            </a>
            , an open catalog maintained by MobilityData and its contributors. Names, places, links, and access details
            come from it and may contain errors or be out of date.
          </p>
          {searching && (
            <>
              <ul className="feed-list">{search.results.map(row)}</ul>
              {search.total > search.results.length && (
                <p className="muted">{`Showing ${search.results.length} of ${search.total} — refine your search`}</p>
              )}
              {search.total === 0 && <p className="muted">No feeds match.</p>}
            </>
          )}
        </>
      )}

      <h3>Import your own</h3>
      <form
        className="url-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = url.trim();
          if (trimmed.length > 0) void start({kind: 'url', url: trimmed}, null);
        }}
      >
        <input
          type="url"
          aria-label="Feed URL"
          placeholder="https://example.com/gtfs.zip"
          value={url}
          required
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit" disabled={importer.running}>
          Import URL
        </button>
      </form>
      <label className="file-label">
        Upload a GTFS zip
        <input
          type="file"
          accept=".zip,application/zip"
          aria-label="Upload GTFS zip"
          data-testid="file-input"
          disabled={importer.running}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) void start({kind: 'file', file}, file.size);
          }}
        />
      </label>
    </section>
  );
}
