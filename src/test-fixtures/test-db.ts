import {loadSqlite, type Database} from '../worker/sqlite.ts';

export async function openMemoryDb(): Promise<Database> {
  const sqlite3 = await loadSqlite();
  return new sqlite3.oo1.DB(':memory:');
}
