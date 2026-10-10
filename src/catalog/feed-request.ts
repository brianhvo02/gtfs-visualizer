/** Shared with the worker and UI: keep this file free of imports other than catalog types. */
import type {CatalogEntry} from './catalog-types.ts';

export interface FeedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export function buildFeedRequest(entry: CatalogEntry, key: string | null): FeedRequest {
  const {access} = entry;
  if (access.kind !== 'key' || key === null) return {url: entry.url, headers: {}};
  if (access.queryParam !== null) {
    const separator = entry.url.includes('?') ? '&' : '?';
    return {
      url: `${entry.url}${separator}${access.queryParam}=${encodeURIComponent(key)}`,
      headers: {},
    };
  }
  if (access.header !== null) return {url: entry.url, headers: {[access.header]: key}};
  return {url: entry.url, headers: {}};
}

/** Origin and path only, so a key in the query string is never shown or stored. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}
