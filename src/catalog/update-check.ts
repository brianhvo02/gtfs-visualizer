import type {FeedRecord} from '../shared/types.ts';
import type {CatalogEntry} from './catalog-types.ts';
import {buildFeedRequest} from './feed-request.ts';

export type UpdateStatus = 'update' | 'current' | 'unknown';

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

/** Weak and strong validators of the same content compare equal here. */
function normalizeEtag(etag: string): string {
  return etag.replace(/^W\//, '');
}

/** Asks the provider (HEAD, no download) whether the feed changed since it was imported. */
export async function checkForUpdate(
  entry: CatalogEntry,
  record: FeedRecord,
  key: string | null,
  fetchFn: FetchFn = defaultFetch,
): Promise<UpdateStatus> {
  if (entry.access.kind === 'download') return 'unknown';
  if (entry.access.kind === 'key' && key === null) return 'unknown';
  if (record.sourceEtag === null && record.sourceLastModified === null) return 'unknown';

  const {url, headers} = buildFeedRequest(entry, key);
  let response: Response;
  try {
    response = await fetchFn(url, {method: 'HEAD', headers, cache: 'no-cache'});
  } catch {
    return 'unknown';
  }
  if (!response.ok) return 'unknown';

  const etag = response.headers.get('ETag');
  if (record.sourceEtag !== null && etag !== null) {
    return normalizeEtag(etag) === normalizeEtag(record.sourceEtag) ? 'current' : 'update';
  }
  const lastModified = response.headers.get('Last-Modified');
  if (record.sourceLastModified !== null && lastModified !== null) {
    return lastModified === record.sourceLastModified ? 'current' : 'update';
  }
  return 'unknown';
}
