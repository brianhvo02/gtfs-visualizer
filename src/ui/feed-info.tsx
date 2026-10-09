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
