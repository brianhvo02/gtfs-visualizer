export const LOCK_NAME = 'gtfs-visualizer-db';

export interface LockLike {
  request(
    name: string,
    options: {ifAvailable?: boolean; steal?: boolean},
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

export interface WorkerLike {
  addEventListener(type: 'error', listener: () => void): void;
  terminate(): void;
}

export interface HostDeps<W extends WorkerLike, S> {
  readonly locks: LockLike;
  readonly isSupported: () => boolean;
  readonly createWorker: () => W;
  readonly connect: (worker: W) => Promise<S>;
}

export type HostState<S> =
  | {readonly kind: 'starting'}
  | {readonly kind: 'ready'; readonly service: S}
  | {readonly kind: 'other-tab'}
  | {readonly kind: 'taken-over'}
  | {readonly kind: 'unsupported'; readonly reason: string}
  | {readonly kind: 'crashed'; readonly message: string};

const UNSUPPORTED_PREFIX = 'unsupported:';
const MAX_RESTARTS = 1;

/** Owns the data worker: one tab at a time (Web Lock), one automatic restart on crash. */
export class WorkerHost<W extends WorkerLike, S> {
  private readonly deps: HostDeps<W, S>;
  private readonly listeners = new Set<() => void>();
  private state: HostState<S> = {kind: 'starting'};
  private worker: W | null = null;
  private restarts = 0;
  private started = false;

  constructor(deps: HostDeps<W, S>) {
    this.deps = deps;
  }

  readonly getState = (): HostState<S> => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.deps.isSupported()) {
      this.setState({
        kind: 'unsupported',
        reason: 'This browser lacks the storage features this app needs.',
      });
      return;
    }
    await this.acquire(false);
  }

  async takeOver(): Promise<void> {
    this.started = true;
    this.restarts = 0;
    await this.acquire(true);
  }

  private acquire(steal: boolean): Promise<void> {
    return new Promise((resolve) => {
      const options = steal ? {steal: true} : {ifAvailable: true};
      this.deps.locks
        .request(LOCK_NAME, options, async (lock) => {
          if (lock === null) {
            this.setState({kind: 'other-tab'});
            resolve();
            return;
          }
          await this.launch();
          resolve();
          // Hold the lock for the life of this tab.
          await new Promise<never>(() => {});
        })
        .catch((error: unknown) => {
          this.terminate();
          if (error instanceof DOMException && error.name === 'AbortError') {
            // Another tab stole the lock.
            this.setState({kind: 'taken-over'});
          } else {
            const message = error instanceof Error ? error.message : String(error);
            this.setState({kind: 'crashed', message});
          }
          resolve();
        });
    });
  }

  private async launch(): Promise<void> {
    this.terminate();
    const worker = this.deps.createWorker();
    this.worker = worker;
    worker.addEventListener('error', () => {
      if (this.worker === worker) void this.handleCrash('The data worker stopped unexpectedly.');
    });
    try {
      const service = await this.deps.connect(worker);
      if (this.worker === worker) this.setState({kind: 'ready', service});
    } catch (error) {
      if (this.worker !== worker) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(UNSUPPORTED_PREFIX)) {
        this.terminate();
        this.setState({kind: 'unsupported', reason: message.slice(UNSUPPORTED_PREFIX.length).trim()});
        return;
      }
      await this.handleCrash(message);
    }
  }

  private async handleCrash(message: string): Promise<void> {
    if (this.restarts >= MAX_RESTARTS) {
      this.terminate();
      this.setState({kind: 'crashed', message});
      return;
    }
    this.restarts++;
    await this.launch();
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private setState(state: HostState<S>): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
