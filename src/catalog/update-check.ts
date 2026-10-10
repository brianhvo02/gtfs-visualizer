import type {FeedRecord} from '../shared/types.ts';
import type {CatalogEntry} from './catalog-types.ts';
import {probeFeed, type FetchFn} from './probe.ts';

export type UpdateStatus = 'update' | 'current' | 'unknown';

/** Weak and strong validators of the same content compare equal here. */
function normalizeEtag(etag: string): string {
  return etag.replace(/^W\//, '');
}

/** Asks the provider (headers only, no download) whether the feed changed since it was imported. */
export async function checkForUpdate(
  entry: CatalogEntry,
  record: FeedRecord,
  key: string | null,
  fetchFn?: FetchFn,
): Promise<UpdateStatus> {
  if (entry.access.kind === 'download') return 'unknown';
  if (entry.access.kind === 'key' && key === null) return 'unknown';
  if (record.sourceEtag === null && record.sourceLastModified === null) return 'unknown';

  const headers = await probeFeed(entry, key, fetchFn);
  if (headers === null) return 'unknown';

  const etag = headers.get('ETag');
  if (record.sourceEtag !== null && etag !== null) {
    return normalizeEtag(etag) === normalizeEtag(record.sourceEtag) ? 'current' : 'update';
  }
  const lastModified = headers.get('Last-Modified');
  if (record.sourceLastModified !== null && lastModified !== null) {
    return lastModified === record.sourceLastModified ? 'current' : 'update';
  }
  return 'unknown';
}
