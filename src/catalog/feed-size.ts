import type {CatalogEntry} from './catalog-types.ts';
import {probeFeed, type FetchFn} from './probe.ts';

/** The feed's download size, or null when it can't be known without downloading. */
export async function fetchFeedSize(
  entry: CatalogEntry,
  key: string | null,
  fetchFn?: FetchFn,
): Promise<number | null> {
  if (entry.access.kind === 'download') return null;
  if (entry.access.kind === 'key' && key === null) return null;
  const headers = await probeFeed(entry, key, fetchFn);
  const size = Number(headers?.get('Content-Length'));
  return Number.isFinite(size) && size > 0 ? size : null;
}
