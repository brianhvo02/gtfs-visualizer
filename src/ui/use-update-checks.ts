import {useEffect, useState} from 'react';
import {getKey} from '../catalog/key-store.ts';
import type {CatalogEntry} from '../catalog/catalog-types.ts';
import {checkForUpdate, type UpdateStatus} from '../catalog/update-check.ts';
import type {FeedRecord} from '../shared/types.ts';

const MAX_CONCURRENT = 4;
/** Results live for the browser session (until reload), keyed by feed id and import time. */
const sessionCache = new Map<string, UpdateStatus>();

function cacheKey(feed: FeedRecord): string {
  return `${feed.id}:${feed.importedAt}`;
}

/** Checks saved catalog feeds whose entry is still in the snapshot, at most four at a time. */
export function useUpdateChecks(
  saved: readonly FeedRecord[],
  entries: readonly CatalogEntry[] | null,
): ReadonlySet<string> {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (entries === null) return;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const queue = saved.filter(
      (feed) => feed.sourceKind === 'catalog' && byId.has(feed.sourceRef) && !sessionCache.has(cacheKey(feed)),
    );
    let cancelled = false;
    const worker = async (): Promise<void> => {
      for (let feed = queue.shift(); feed !== undefined; feed = queue.shift()) {
        const entry = byId.get(feed.sourceRef);
        if (entry === undefined) continue;
        const access = entry.access;
        const key = access.kind === 'key' ? getKey(access.provider) : null;
        const status = await checkForUpdate(entry, feed, key);
        sessionCache.set(cacheKey(feed), status);
        if (!cancelled) setTick((n) => n + 1);
      }
    };
    for (let i = 0; i < MAX_CONCURRENT; i++) void worker();
    return () => {
      cancelled = true;
    };
  }, [saved, entries]);

  return new Set(saved.filter((feed) => sessionCache.get(cacheKey(feed)) === 'update').map((feed) => feed.id));
}
