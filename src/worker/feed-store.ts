import type {Sqlite3Static} from '@sqlite.org/sqlite-wasm';
import type {Database} from './sqlite.ts';

/** Where feed databases live. OPFS in the browser; memory in tests and scripts. */
export interface FeedStore {
  open(filename: string): Database;
  close(filename: string): void;
  remove(filename: string): void;
  list(): string[];
  prepareForNewDb(): Promise<void>;
}

/** Keeps every database open in memory; `close` is a no-op so data survives reopening. */
export class MemoryFeedStore implements FeedStore {
  private readonly sqlite3: Sqlite3Static;
  private readonly dbs = new Map<string, Database>();

  constructor(sqlite3: Sqlite3Static) {
    this.sqlite3 = sqlite3;
  }

  open(filename: string): Database {
    let db = this.dbs.get(filename);
    if (db === undefined) {
      db = new this.sqlite3.oo1.DB(':memory:');
      this.dbs.set(filename, db);
    }
    return db;
  }

  close(_filename: string): void {}

  remove(filename: string): void {
    this.dbs.get(filename)?.close();
    this.dbs.delete(filename);
  }

  list(): string[] {
    return [...this.dbs.keys()];
  }

  async prepareForNewDb(): Promise<void> {}
}
