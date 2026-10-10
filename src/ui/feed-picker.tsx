import {useState, type ReactElement} from 'react';
import {loadCatalog} from '../catalog/catalog.ts';
import type {CatalogEntry} from '../catalog/catalog-types.ts';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {FeedRecord, ImportFailure, ImportSource} from '../shared/types.ts';
import {describeProgress, formatServiceDate} from './format.ts';
import {useAsync} from './use-async.ts';
import {useImport} from './use-import.ts';

export interface FeedPickerProps {
  readonly service: FeedApi;
  readonly onOpen: (feedId: string) => void;
}

function catalogSource(entry: CatalogEntry): ImportSource {
  return {kind: 'catalog', entry, key: null};
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
  const saved = feeds.status === 'ok' ? feeds.value : [];
  // Interim: the full picker (Task 6) replaces this featured-direct-only list.
  const catalogFeeds =
    catalog.status === 'ok'
      ? catalog.value.entries.filter((entry) => entry.featured && entry.access.kind === 'direct')
      : [];
  const savedIds = new Set(saved.map((feed) => feed.id));

  const start = async (source: ImportSource, sizeHint: number | null): Promise<void> => {
    const feed = await importer.run(source, sizeHint);
    setVersion((v) => v + 1);
    if (feed !== null) onOpen(feed.id);
  };

  const reimport = async (feed: FeedRecord): Promise<void> => {
    if (feed.sourceKind === 'url') {
      await start({kind: 'url', url: feed.sourceRef}, null);
      return;
    }
    const entry = catalogFeeds.find((candidate) => candidate.id === feed.sourceRef);
    if (entry !== undefined) await start(catalogSource(entry), null);
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

      <h3>Catalog</h3>
      {catalog.status === 'loading' && <p className="muted">Loading catalog…</p>}
      {catalog.status === 'error' && <p className="muted">The catalog is unavailable right now.</p>}
      <ul className="feed-list">
        {catalogFeeds.map((entry) => {
          const verb = savedIds.has(entry.id) ? 'Re-import' : 'Import';
          return (
            <li key={entry.id}>
              <span>{entry.name}</span>
              <span className="muted">{entry.place}</span>
              <button
                type="button"
                disabled={importer.running}
                aria-label={`${verb} ${entry.name}`}
                onClick={() => void start(catalogSource(entry), null)}
              >
                {verb}
              </button>
            </li>
          );
        })}
      </ul>

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
