import sqlite3InitModule, {type Sqlite3Static} from '@sqlite.org/sqlite-wasm';

export type {Database, SqlValue} from '@sqlite.org/sqlite-wasm';

let loading: Promise<Sqlite3Static> | null = null;

/** Loads the sqlite-wasm module once per thread. */
export function loadSqlite(): Promise<Sqlite3Static> {
  loading ??= sqlite3InitModule();
  return loading;
}
