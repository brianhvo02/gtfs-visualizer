import {describe, expect, it} from 'vitest';
import {WorkerHost, type LockLike, type WorkerLike} from './worker-host.ts';

class FakeWorker implements WorkerLike {
  private readonly listeners: Array<() => void> = [];
  terminated = false;

  addEventListener(_type: 'error', listener: () => void): void {
    this.listeners.push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  crash(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Single-name lock manager with ifAvailable/steal semantics, shared between "tabs". */
class FakeLocks implements LockLike {
  private holder: {reject: (error: unknown) => void} | null = null;

  async request(
    _name: string,
    options: {ifAvailable?: boolean; steal?: boolean},
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown> {
    if (this.holder !== null) {
      if (options.steal === true) {
        this.holder.reject(new DOMException('Lock stolen', 'AbortError'));
        this.holder = null;
      } else if (options.ifAvailable === true) {
        await callback(null);
        return undefined;
      }
    }
    return new Promise((resolve, reject) => {
      this.holder = {reject};
      callback({}).then(resolve, reject);
    });
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeHost(
  locks: FakeLocks,
  options: {supported?: boolean; connectError?: string} = {},
): {host: WorkerHost<FakeWorker, string>; workers: FakeWorker[]} {
  const workers: FakeWorker[] = [];
  const host = new WorkerHost<FakeWorker, string>({
    locks,
    isSupported: () => options.supported ?? true,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    connect: async () => {
      if (options.connectError !== undefined) throw new Error(options.connectError);
      return `svc-${workers.length}`;
    },
  });
  return {host, workers};
}

describe('WorkerHost', () => {
  it('becomes ready after acquiring the lock', async () => {
    const {host} = makeHost(new FakeLocks());
    await host.start();
    expect(host.getState()).toEqual({kind: 'ready', service: 'svc-1'});
  });

  it('ignores repeated start calls', async () => {
    const {host, workers} = makeHost(new FakeLocks());
    await Promise.all([host.start(), host.start()]);
    expect(workers).toHaveLength(1);
    expect(host.getState().kind).toBe('ready');
  });

  it('reports another tab holding the lock, and can take over', async () => {
    const locks = new FakeLocks();
    const first = makeHost(locks);
    const second = makeHost(locks);
    await first.host.start();
    await second.host.start();
    expect(second.host.getState()).toEqual({kind: 'other-tab'});

    await second.host.takeOver();
    await flush();
    expect(second.host.getState()).toEqual({kind: 'ready', service: 'svc-1'});
    expect(first.host.getState()).toEqual({kind: 'taken-over'});
    expect(first.workers[0]?.terminated).toBe(true);
  });

  it('notifies subscribers on state changes', async () => {
    const {host} = makeHost(new FakeLocks());
    const seen: string[] = [];
    host.subscribe(() => seen.push(host.getState().kind));
    await host.start();
    expect(seen).toEqual(['ready']);
  });

  it('reports unsupported browsers without creating a worker', async () => {
    const {host, workers} = makeHost(new FakeLocks(), {supported: false});
    await host.start();
    expect(host.getState().kind).toBe('unsupported');
    expect(workers).toHaveLength(0);
  });

  it('reports unsupported when the worker says so', async () => {
    const {host} = makeHost(new FakeLocks(), {connectError: 'unsupported: no OPFS'});
    await host.start();
    expect(host.getState()).toEqual({kind: 'unsupported', reason: 'no OPFS'});
  });

  it('restarts once after a crash, then gives up', async () => {
    const {host, workers} = makeHost(new FakeLocks());
    await host.start();
    workers[0]?.crash();
    await flush();
    expect(host.getState()).toEqual({kind: 'ready', service: 'svc-2'});
    expect(workers[0]?.terminated).toBe(true);
    workers[1]?.crash();
    await flush();
    expect(host.getState().kind).toBe('crashed');
  });
});
