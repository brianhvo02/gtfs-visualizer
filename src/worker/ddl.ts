import {GTFS_TABLES, secsColumn, type ColumnDef} from '../gtfs/schema.ts';
import type {Database} from './sqlite.ts';

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
