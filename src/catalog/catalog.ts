import type {FeedRecord} from '../shared/types.ts';
import {
  CATALOG_FILE,
  feedZipKey,
  LOCK_FILE,
  parseCatalog,
  parseLock,
  type CatalogEntry,
} from './catalog-types.ts';

export interface CatalogFeed extends CatalogEntry {
  readonly zipUrl: string;
  readonly sha256: string | null;
  readonly size: number | null;
  readonly fetchedAt: string | null;
  readonly available: boolean;
}

async function getJson(fetchFn: (url: string) => Promise<Response>, url: string): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.json();
}

export async function fetchCatalog(
  baseUrl: string,
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url, {cache: 'no-cache'}),
): Promise<CatalogFeed[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const catalog = parseCatalog(await getJson(fetchFn, `${base}/${CATALOG_FILE}`));
  let lockJson: unknown = null;
  try {
    lockJson = await getJson(fetchFn, `${base}/${LOCK_FILE}`);
  } catch {
    // Not mirrored yet: every entry shows as unavailable.
  }
  const lock = parseLock(lockJson);
  return catalog.map((entry): CatalogFeed => {
    const mirrored = lock.feeds[entry.id];
    const sha256 = mirrored?.sha256 ?? null;
    return {
      ...entry,
      zipUrl: `${base}/${feedZipKey(entry.id)}`,
      sha256,
      size: mirrored?.size ?? null,
      fetchedAt: mirrored?.fetchedAt ?? null,
      available: sha256 !== null,
    };
  });
}

export function isUpdateAvailable(feed: CatalogFeed, record: FeedRecord | undefined): boolean {
  return (
    record !== undefined &&
    record.sourceKind === 'catalog' &&
    feed.sha256 !== null &&
    record.catalogSha256 !== feed.sha256
  );
}
