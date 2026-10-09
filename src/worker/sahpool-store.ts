import type {SAHPoolUtil, Sqlite3Static} from '@sqlite.org/sqlite-wasm';
import type {FeedStore} from './feed-store.ts';
import type {Database} from './sqlite.ts';

const POOL_NAME = 'gtfs-visualizer';
const INITIAL_CAPACITY = 8;
/** A database plus its journal and temp files. */
const SLOTS_PER_NEW_DB = 4;
/** After another tab hands over, its worker may take a moment to release OPFS handles. */
const INSTALL_ATTEMPTS = 10;
const INSTALL_RETRY_MS = 500;

class SahPoolFeedStore implements FeedStore {
  private readonly pool: SAHPoolUtil;
  private readonly handles = new Map<string, Database>();

  constructor(pool: SAHPoolUtil) {
    this.pool = pool;
  }

  open(filename: string): Database {
    let db = this.handles.get(filename);
    if (db === undefined) {
      db = new this.pool.OpfsSAHPoolDb(filename);
      this.handles.set(filename, db);
    }
    return db;
  }

  close(filename: string): void {
    this.handles.get(filename)?.close();
    this.handles.delete(filename);
  }

  remove(filename: string): void {
    this.close(filename);
    this.pool.unlink(filename);
  }

  list(): string[] {
    return this.pool.getFileNames().filter((name) => name.endsWith('.db'));
  }

  async prepareForNewDb(): Promise<void> {
    await this.pool.reserveMinimumCapacity(Number(this.pool.getFileCount()) + SLOTS_PER_NEW_DB);
  }
}

export async function createSahPoolStore(sqlite3: Sqlite3Static): Promise<FeedStore> {
  // sqlite-wasm caches a failed init and rethrows it unless forced to retry.
  const options = {
    name: POOL_NAME,
    initialCapacity: INITIAL_CAPACITY,
    forceReinitIfPreviouslyFailed: true,
  };
  let lastError: unknown = null;
  for (let attempt = 0; attempt < INSTALL_ATTEMPTS; attempt++) {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs(options);
      return new SahPoolFeedStore(pool);
    } catch (error) {
      lastError = error;
      if (attempt < INSTALL_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, INSTALL_RETRY_MS));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
