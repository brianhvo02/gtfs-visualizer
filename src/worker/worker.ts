import * as Comlink from 'comlink';
import {FeedService} from './feed-service.ts';
import {createSahPoolStore} from './sahpool-store.ts';
import {loadSqlite} from './sqlite.ts';

function hasSyncAccessHandles(): boolean {
  return (
    typeof FileSystemFileHandle !== 'undefined' &&
    'createSyncAccessHandle' in FileSystemFileHandle.prototype
  );
}

async function start(): Promise<FeedService & Comlink.ProxyMarked> {
  if (typeof navigator.storage?.getDirectory !== 'function' || !hasSyncAccessHandles()) {
    throw new Error('unsupported: this browser has no Origin Private File System support in workers.');
  }
  const sqlite3 = await loadSqlite();
  const store = await createSahPoolStore(sqlite3);
  const service = new FeedService(store, {
    fetch: (url) => fetch(url),
    now: () => new Date(),
    estimate: () => navigator.storage.estimate(),
  });
  service.init();
  return Comlink.proxy(service);
}

const workerApi = {start};

export type WorkerApi = typeof workerApi;

Comlink.expose(workerApi);
