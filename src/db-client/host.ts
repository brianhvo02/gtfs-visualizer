import * as Comlink from 'comlink';
import type {WorkerApi} from '../worker/worker.ts';
import type {FeedApi} from './feed-api.ts';
import {isBrowserSupported} from './support.ts';
import {WorkerHost} from './worker-host.ts';

export const host = new WorkerHost<Worker, FeedApi>({
  // Wrapped so the call matches LockLike exactly rather than LockManager's overloads.
  locks: {
    request: (name, options, callback) => navigator.locks.request(name, options, callback),
  },
  isSupported: isBrowserSupported,
  createWorker: () =>
    new Worker(new URL('../worker/worker.ts', import.meta.url), {type: 'module'}),
  connect: async (worker) => {
    const api = Comlink.wrap<WorkerApi>(worker);
    return await api.start();
  },
});
