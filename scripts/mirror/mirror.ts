import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {
  CATALOG_FILE,
  feedZipKey,
  LOCK_FILE,
  parseLock,
  type CatalogEntry,
  type CatalogLock,
  type CatalogLockEntry,
} from '../../src/catalog/catalog-types.ts';

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getText(key: string): Promise<string | null>;
}

export interface MirrorDeps {
  readonly fetch: (url: string) => Promise<Response>;
  readonly store: ObjectStore;
  readonly now: () => Date;
  readonly log: (message: string) => void;
}

export interface MirrorReport {
  readonly lock: CatalogLock;
  readonly failures: readonly string[];
}

/** Returns a problem description, or null if the bytes look like a GTFS zip. */
export function checkGtfsZip(bytes: Uint8Array): string | null {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    return 'not a valid zip archive';
  }
  return names.some((name) => name.split('/').at(-1) === 'stops.txt')
    ? null
    : 'zip does not contain stops.txt';
}

export async function mirrorCatalog(
  catalog: readonly CatalogEntry[],
  deps: MirrorDeps,
): Promise<MirrorReport> {
  const previousText = await deps.store.getText(LOCK_FILE);
  const previous = parseLock(previousText === null ? null : JSON.parse(previousText));
  const feeds: Record<string, CatalogLockEntry> = {};
  const failures: string[] = [];

  for (const entry of catalog) {
    const prior = previous.feeds[entry.id];
    const at = deps.now().toISOString();
    try {
      const response = await deps.fetch(entry.sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const problem = checkGtfsZip(bytes);
      if (problem !== null) throw new Error(problem);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const unchanged = prior?.sha256 === sha256;
      if (!unchanged) await deps.store.put(feedZipKey(entry.id), bytes, 'application/zip');
      feeds[entry.id] = {sha256, size: bytes.length, fetchedAt: at, lastError: null, lastErrorAt: null};
      deps.log(`${entry.id}: ok (${bytes.length} bytes${unchanged ? ', unchanged' : ''})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(entry.id);
      feeds[entry.id] = {
        sha256: prior?.sha256 ?? null,
        size: prior?.size ?? null,
        fetchedAt: prior?.fetchedAt ?? null,
        lastError: message,
        lastErrorAt: at,
      };
      deps.log(`${entry.id}: FAILED — ${message}`);
    }
  }

  const lock: CatalogLock = {generatedAt: deps.now().toISOString(), feeds};
  const encoder = new TextEncoder();
  await deps.store.put(CATALOG_FILE, encoder.encode(JSON.stringify(catalog, null, 2)), 'application/json');
  await deps.store.put(LOCK_FILE, encoder.encode(JSON.stringify(lock, null, 2)), 'application/json');
  return {lock, failures};
}
