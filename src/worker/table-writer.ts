import type {PreparedStatement} from '@sqlite.org/sqlite-wasm';
import {secsColumn, type ColumnDef, type TableDef} from '../gtfs/schema.ts';
import {parseGtfsTime} from '../gtfs/time.ts';
import type {IssueCollector} from './issues.ts';
import type {Database, SqlValue} from './sqlite.ts';

export interface RowWriter {
  write(fields: readonly string[], line: number): void;
  /** Finalizes the statement and returns the number of rows written. */
  finish(): number;
}

/** Commits every `size` rows so huge files don't build one giant transaction. */
export class TxBatcher {
  private readonly db: Database;
  private readonly size: number;
  private pending = 0;

  constructor(db: Database, size: number) {
    this.db = db;
    this.size = size;
  }

  begin(): void {
    this.db.exec('BEGIN');
  }

  tick(): void {
    this.pending++;
    if (this.pending >= this.size) {
      this.db.exec('COMMIT; BEGIN');
      this.pending = 0;
    }
  }

  commit(): void {
    this.db.exec('COMMIT');
    this.pending = 0;
  }
}

interface Converted {
  readonly value: SqlValue;
  readonly ok: boolean;
}

const INT_PATTERN = /^-?\d+$/;

function convert(type: ColumnDef['type'], raw: string): Converted {
  if (raw.length === 0) return {value: null, ok: true};
  switch (type) {
    case 'int':
      return INT_PATTERN.test(raw) ? {value: Number(raw), ok: true} : {value: null, ok: false};
    case 'real': {
      const value = Number(raw);
      return Number.isFinite(value) ? {value, ok: true} : {value: null, ok: false};
    }
    case 'time':
    case 'text':
      return {value: raw, ok: true};
  }
}

interface BoundColumn {
  readonly def: ColumnDef;
  readonly index: number;
}

export function createTableWriter(
  db: Database,
  def: TableDef,
  header: readonly string[],
  issues: IssueCollector,
  onRow: () => void,
): RowWriter | null {
  const positions = new Map(header.map((name, index) => [name, index]));
  const missing = def.columns.filter((c) => c.required === true && !positions.has(c.name));
  if (missing.length > 0) {
    for (const column of missing) {
      issues.add({
        severity: def.requiredFile ? 'fatal' : 'error',
        file: def.file,
        line: 1,
        column: column.name,
        code: 'missing_column',
        message: def.requiredFile
          ? `${def.file} is missing required column ${column.name}.`
          : `${def.file} is missing required column ${column.name}; the file was skipped.`,
      });
    }
    return null;
  }

  const bound: BoundColumn[] = [];
  for (const column of def.columns) {
    const index = positions.get(column.name);
    if (index !== undefined) bound.push({def: column, index});
  }
  const names = bound.flatMap((b) =>
    b.def.type === 'time' ? [b.def.name, secsColumn(b.def.name)] : [b.def.name],
  );
  const statement: PreparedStatement = db.prepare(
    `INSERT INTO ${def.table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
  );
  let count = 0;

  return {
    write(fields, line) {
      if (fields.length !== header.length) {
        issues.add({
          severity: 'warning',
          file: def.file,
          line,
          column: null,
          code: 'ragged_row',
          message: `Expected ${header.length} fields but found ${fields.length}.`,
        });
      }
      if (def.checkRow !== undefined) {
        const message = def.checkRow((column) => {
          const index = positions.get(column);
          return index === undefined ? '' : (fields[index] ?? '').trim();
        });
        if (message !== null) {
          issues.add({
            severity: 'error',
            file: def.file,
            line,
            column: null,
            code: 'invalid_value',
            message,
          });
          return;
        }
      }
      const values: SqlValue[] = [];
      for (const {def: column, index} of bound) {
        const raw = (fields[index] ?? '').trim();
        if (raw.length === 0 && column.required === true) {
          issues.add({
            severity: 'error',
            file: def.file,
            line,
            column: column.name,
            code: 'missing_value',
            message: `Required value ${column.name} is empty.`,
          });
        }
        const converted = convert(column.type, raw);
        if (!converted.ok) {
          issues.add({
            severity: 'warning',
            file: def.file,
            line,
            column: column.name,
            code: 'invalid_value',
            message: `"${raw}" is not a valid ${column.type} for ${column.name}.`,
          });
        }
        values.push(converted.value);
        if (column.type === 'time') {
          const secs = raw.length === 0 ? null : parseGtfsTime(raw);
          if (raw.length > 0 && secs === null) {
            issues.add({
              severity: 'warning',
              file: def.file,
              line,
              column: column.name,
              code: 'invalid_value',
              message: `"${raw}" is not a valid GTFS time for ${column.name}.`,
            });
          }
          values.push(secs);
        }
      }
      statement.bind(values).stepReset();
      count++;
      onRow();
    },
    finish() {
      statement.finalize();
      return count;
    },
  };
}

export function createExtraFileWriter(
  db: Database,
  fileName: string,
  header: readonly string[],
  onRow: () => void,
): RowWriter {
  const statement = db.prepare('INSERT INTO extra_files (file_name, line, json) VALUES (?, ?, ?)');
  let count = 0;
  return {
    write(fields, line) {
      const record = Object.fromEntries(header.map((name, i) => [name, fields[i] ?? '']));
      statement.bind([fileName, line, JSON.stringify(record)]).stepReset();
      count++;
      onRow();
    },
    finish() {
      statement.finalize();
      return count;
    },
  };
}
