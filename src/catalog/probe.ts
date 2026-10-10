import type {CatalogEntry} from './catalog-types.ts';
import {buildFeedRequest} from './feed-request.ts';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

/**
 * Response headers for a catalog feed without downloading it. Uses GET, not HEAD: some hosts (Mobility Database's
 * storage among them) only send CORS headers on GET. The body is cancelled as soon as the headers arrive.
 */
export async function probeFeed(
  entry: CatalogEntry,
  key: string | null,
  fetchFn: FetchFn = defaultFetch,
): Promise<Headers | null> {
  const {url, headers} = buildFeedRequest(entry, key);
  const controller = new AbortController();
  try {
    const response = await fetchFn(url, {method: 'GET', headers, cache: 'no-cache', signal: controller.signal});
    return response.ok ? response.headers : null;
  } catch {
    return null;
  } finally {
    controller.abort();
  }
}
