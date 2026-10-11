import {GTFS_TABLES, secsColumn, type ColumnDef} from '../gtfs/schema.ts';
import type {Database} from './sqlite.ts';

/** Bytes per page for feed databases; larger pages mean far fewer OPFS reads (see docs/perf-baseline.md). */
export const FEED_PAGE_SIZE = 65_536;
/** Page cache while importing, in KiB. Derive walks stop_times in trip order and needs it. */
const IMPORT_CACHE_KIB = 65_536;

/**
 * Prepares a new, empty feed database for a bulk import: large pages (must be set before any table exists),
 * a bigger page cache for this connection, and no journal or syncing until the import finishes.
 */
export function configureForImport(db: Database): void {
  db.exec(`
    PRAGMA page_size = ${FEED_PAGE_SIZE};
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -${IMPORT_CACHE_KIB};
  `);
}

function columnSql(column: ColumnDef): string {
  switch (column.type) {
    case 'int':
      return `${column.name} INTEGER`;
    case 'real':
      return `${column.name} REAL`;
    case 'time':
      return `${column.name} TEXT, ${secsColumn(column.name)} INTEGER`;
    case 'text':
      return `${column.name} TEXT`;
  }
}

export function createGtfsTables(db: Database): void {
  for (const def of GTFS_TABLES) {
    db.exec(`CREATE TABLE ${def.table} (${def.columns.map(columnSql).join(', ')})`);
  }
  db.exec(`
    CREATE TABLE extra_files (file_name TEXT NOT NULL, line INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE TABLE import_issues (
      severity TEXT NOT NULL,
      file TEXT,
      line INTEGER,
      column_name TEXT,
      code TEXT NOT NULL,
      message TEXT NOT NULL
    );
  `);
}

export function createGtfsIndexes(db: Database): void {
  for (const def of GTFS_TABLES) {
    for (const columns of def.indexes) {
      const name = `idx_${def.table}_${columns.join('_')}`;
      db.exec(`CREATE INDEX ${name} ON ${def.table} (${columns.join(', ')})`);
    }
  }
}
