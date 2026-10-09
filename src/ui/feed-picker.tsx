import {useState, type ReactElement} from 'react';
import {fetchCatalog, isUpdateAvailable, type CatalogFeed} from '../catalog/catalog.ts';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {FeedRecord, ImportFailure, ImportSource} from '../shared/types.ts';
import {describeProgress, formatServiceDate} from './format.ts';
import {useAsync} from './use-async.ts';
import {useImport} from './use-import.ts';

export interface FeedPickerProps {
  readonly service: FeedApi;
  readonly catalogBaseUrl: string | null;
  readonly onOpen: (feedId: string) => void;
}

function catalogSource(entry: CatalogFeed): ImportSource {
  return {kind: 'catalog', id: entry.id, name: entry.name, url: entry.zipUrl, sha256: entry.sha256};
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

export function FeedPicker({service, catalogBaseUrl, onOpen}: FeedPickerProps): ReactElement {
  const [version, setVersion] = useState(0);
  const [url, setUrl] = useState('');
  const feeds = useAsync(() => service.listFeeds(), [service, version]);
  const catalog = useAsync(
    async () => (catalogBaseUrl === null ? [] : await fetchCatalog(catalogBaseUrl)),
    [catalogBaseUrl],
  );
  const importer = useImport(service);
  const saved = feeds.status === 'ok' ? feeds.value : [];
  const catalogFeeds = catalog.status === 'ok' ? catalog.value : [];
  const savedIds = new Set(saved.map((feed) => feed.id));

  const start = async (source: ImportSource, sizeHint: number | null): Promise<void> => {
    const feed = await importer.run(source, sizeHint);
    setVersion((v) => v + 1);
    if (feed !== null) onOpen(feed.id);
  };

  const catalogEntryFor = (feed: FeedRecord): CatalogFeed | undefined =>
    feed.sourceKind === 'catalog' ? catalogFeeds.find((entry) => entry.id === feed.sourceRef) : undefined;

  const reimport = async (feed: FeedRecord): Promise<void> => {
    if (feed.sourceKind === 'url') {
      await start({kind: 'url', url: feed.sourceRef}, null);
      return;
    }
    const entry = catalogEntryFor(feed);
    if (entry !== undefined && entry.available) await start(catalogSource(entry), entry.size);
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
            const entry = catalogEntryFor(feed);
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
                {entry !== undefined && isUpdateAvailable(entry, feed) && (
                  <span className="badge">Update available</span>
                )}
                <span className="row-actions">
                  {feed.sourceKind !== 'file' && (
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

      {catalogBaseUrl !== null && (
        <>
          <h3>Catalog</h3>
          {catalog.status === 'loading' && <p className="muted">Loading catalog…</p>}
          {catalog.status === 'error' && <p className="muted">The catalog is unavailable right now.</p>}
          <ul className="feed-list">
            {catalogFeeds.map((entry) => {
              const verb = savedIds.has(entry.id) ? 'Re-import' : 'Import';
              return (
                <li key={entry.id}>
                  <span>{entry.name}</span>
                  <span className="muted">{entry.region}</span>
                  <button
                    type="button"
                    disabled={!entry.available || importer.running}
                    aria-label={`${verb} ${entry.name}`}
                    onClick={() => void start(catalogSource(entry), entry.size)}
                  >
                    {entry.available ? verb : 'Not mirrored yet'}
                  </button>
                </li>
              );
            })}
          </ul>
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
