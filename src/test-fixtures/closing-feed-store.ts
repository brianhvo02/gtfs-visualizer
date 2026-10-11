import type {Sqlite3Static} from '@sqlite.org/sqlite-wasm';
import type {FeedStore} from '../worker/feed-store.ts';
import type {Database} from '../worker/sqlite.ts';

/**
 * An in-memory FeedStore whose `close` really closes the handle (so a use after close throws, as with OPFS)
 * while keeping the bytes, which the next `open` restores.
 */
export class ClosingMemoryFeedStore implements FeedStore {
  private readonly sqlite3: Sqlite3Static;
  private readonly handles = new Map<string, Database>();
  private readonly saved = new Map<string, Uint8Array>();

  constructor(sqlite3: Sqlite3Static) {
    this.sqlite3 = sqlite3;
  }

  open(filename: string): Database {
    const existing = this.handles.get(filename);
    if (existing !== undefined) return existing;
    const db = new this.sqlite3.oo1.DB(':memory:');
    const bytes = this.saved.get(filename);
    if (bytes !== undefined) this.restore(db, bytes);
    this.handles.set(filename, db);
    return db;
  }

  close(filename: string): void {
    const db = this.handles.get(filename);
    if (db === undefined) return;
    this.saved.set(filename, this.sqlite3.capi.sqlite3_js_db_export(db));
    db.close();
    this.handles.delete(filename);
  }

  remove(filename: string): void {
    this.handles.get(filename)?.close();
    this.handles.delete(filename);
    this.saved.delete(filename);
  }

  list(): string[] {
    return [...new Set([...this.handles.keys(), ...this.saved.keys()])];
  }

  async prepareForNewDb(): Promise<void> {}

  private restore(db: Database, bytes: Uint8Array): void {
    const {capi, wasm} = this.sqlite3;
    const pointer = wasm.allocFromTypedArray(bytes);
    const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const rc = capi.sqlite3_deserialize(db, 'main', pointer, bytes.byteLength, bytes.byteLength, flags);
    if (rc !== 0) throw new Error(`sqlite3_deserialize failed: ${rc}`);
  }
}
