import type {ReactElement} from 'react';
import type {FeedRecord, FeedSummary} from '../shared/types.ts';
import {formatServiceDate} from './format.ts';

const COUNTED_TABLES = ['agency', 'routes', 'stops', 'trips', 'stop_times', 'shapes'];

const SOURCE_LABELS: Readonly<Record<FeedRecord['sourceKind'], string>> = {
  catalog: 'Catalog',
  url: 'URL',
  file: 'Uploaded file',
};

export function FeedInfo({feed, summary}: {readonly feed: FeedRecord; readonly summary: FeedSummary}): ReactElement {
  return (
    <details className="panel feed-info">
      <summary>Feed details</summary>
      <dl>
        <dt>Agencies</dt>
        <dd>{summary.agencies.map((agency) => agency.name).join(', ') || '—'}</dd>
        {summary.feedInfo !== null && (
          <>
            <dt>Publisher</dt>
            <dd>{summary.feedInfo.publisherName ?? '—'}</dd>
            <dt>Version</dt>
            <dd>{summary.feedInfo.version ?? '—'}</dd>
          </>
        )}
        <dt>Service dates</dt>
        <dd>
          {formatServiceDate(summary.serviceStart)} – {formatServiceDate(summary.serviceEnd)}
        </dd>
        <dt>Time zone</dt>
        <dd>{summary.timezone ?? 'Invalid in feed; using your time zone'}</dd>
        <dt>Source</dt>
        <dd>
          {SOURCE_LABELS[feed.sourceKind]}: {feed.sourceRef}
        </dd>
        <dt>Imported</dt>
        <dd>{new Date(feed.importedAt).toLocaleString()}</dd>
        <dt>Import notes</dt>
        <dd>{summary.issueCount === 0 ? 'None' : `${summary.issueCount} recorded`}</dd>
      </dl>
      {feed.sourceKind === 'catalog' && (
        <p className="muted data-line">
          Data: {summary.agencies.map((agency) => agency.name).join(', ') || '—'}
          {feed.license !== null && (
            <>
              {' · '}
              {/^https?:\/\//.test(feed.license) ? (
                <a href={feed.license} target="_blank" rel="noreferrer">
                  License
                </a>
              ) : (
                `License: ${feed.license}`
              )}
            </>
          )}
        </p>
      )}
      {feed.sourceKind === 'catalog' && feed.viaMobilityDatabase && (
        <p className="muted disclaimer">
          Downloaded from the{' '}
          <a href="https://mobilitydatabase.org" target="_blank" rel="noreferrer">
            Mobility Database
          </a>
          's copy of this feed. Open data may lag behind or differ from the agency's own release.
        </p>
      )}
      <table className="counts">
        <tbody>
          {COUNTED_TABLES.map((table) => (
            <tr key={table}>
              <th scope="row">{table}</th>
              <td>{(summary.counts[table] ?? 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
