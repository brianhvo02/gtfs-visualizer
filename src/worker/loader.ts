import {Unzip, UnzipInflate} from 'fflate';
import {CsvParser} from '../gtfs/csv.ts';
import {GTFS_TABLES, tableForFile} from '../gtfs/schema.ts';
import type {ImportProgress} from '../shared/types.ts';
import {createGtfsIndexes} from './ddl.ts';
import type {IssueCollector} from './issues.ts';
import type {Database} from './sqlite.ts';
import {
  createExtraFileWriter,
  createTableWriter,
  TxBatcher,
  type RowWriter,
} from './table-writer.ts';

export class NotZipError extends Error {
  constructor() {
    super('The file is not a zip archive.');
    this.name = 'NotZipError';
  }
}

export interface LoadOptions {
  readonly onProgress?: (progress: ImportProgress) => void;
  readonly bytesTotal?: number | null;
  readonly batchSize?: number;
}

export interface LoadResult {
  readonly filesLoaded: readonly string[];
  readonly fatal: boolean;
}

const DEFAULT_BATCH_SIZE = 10_000;
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/** Base file name for a zip entry, or null for directories and macOS metadata. */
function entryBaseName(path: string): string | null {
  if (path.endsWith('/')) return null;
  const segments = path.split('/');
  if (segments.includes('__MACOSX')) return null;
  const base = segments[segments.length - 1] ?? '';
  if (base.length === 0 || base.startsWith('._')) return null;
  return base;
}

interface FileConsumer {
  push(chunk: Uint8Array, final: boolean): void;
}

function createFileConsumer(
  db: Database,
  name: string,
  issues: IssueCollector,
  onRow: () => void,
): FileConsumer | null {
  const def = tableForFile(name);
  if (def === undefined && !/\.(txt|csv)$/i.test(name)) return null;
  const decoder = new TextDecoder('utf-8');
  let header: string[] | null = null;
  let writer: RowWriter | null = null;
  const parser = new CsvParser(
    (fields, line) => {
      if (header === null) {
        header = fields.map((field) => field.trim());
        writer =
          def === undefined
            ? createExtraFileWriter(db, name, header, onRow)
            : createTableWriter(db, def, header, issues, onRow);
        return;
      }
      writer?.write(fields, line);
    },
    (line, message) =>
      issues.add({severity: 'error', file: name, line, column: null, code: 'csv_syntax', message}),
  );
  return {
    push(chunk, final) {
      parser.push(decoder.decode(chunk, {stream: true}));
      if (!final) return;
      parser.push(decoder.decode());
      parser.end();
      writer?.finish();
      if (header === null && def !== undefined) {
        issues.add({
          severity: def.requiredFile ? 'fatal' : 'warning',
          file: name,
          line: null,
          column: null,
          code: 'empty_file',
          message: `${name} is empty.`,
        });
      }
    },
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

export async function loadGtfsZip(
  db: Database,
  stream: ReadableStream<Uint8Array>,
  issues: IssueCollector,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const batcher = new TxBatcher(db, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const seen = new Set<string>();
  const filesLoaded: string[] = [];
  let currentFile: string | undefined;
  let rowsDone = 0;
  let bytesDone = 0;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    const name = entryBaseName(file.name);
    if (name === null) return;
    if (seen.has(name)) {
      issues.add({
        severity: 'warning',
        file: name,
        line: null,
        column: null,
        code: 'duplicate_file',
        message: `Ignored a second copy of ${name} at ${file.name}.`,
      });
      return;
    }
    seen.add(name);
    const consumer = createFileConsumer(db, name, issues, () => {
      rowsDone++;
      batcher.tick();
    });
    if (consumer === null) return;
    currentFile = name;
    rowsDone = 0;
    file.ondata = (error, chunk, final) => {
      if (error !== null) {
        issues.add({
          severity: 'error',
          file: name,
          line: null,
          column: null,
          code: 'zip_error',
          message: error.message,
        });
        return;
      }
      consumer.push(chunk, final);
      if (final) filesLoaded.push(name);
    };
    file.start();
  };

  const reader = stream.getReader();
  let head = new Uint8Array(0);
  let checked = false;
  // The transaction opens only after the signature passes, so a rejected input leaves no open BEGIN.
  // Any other failure leaves the transaction open; the caller discards the whole database.
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    let chunk = value;
    if (!checked) {
      head = concat(head, value);
      if (head.length < ZIP_SIGNATURE.length) continue;
      if (!hasZipSignature(head)) {
        await reader.cancel();
        throw new NotZipError();
      }
      checked = true;
      batcher.begin();
      chunk = head;
    }
    bytesDone += chunk.length;
    unzip.push(chunk, false);
    options.onProgress?.({
      stage: 'parse',
      file: currentFile,
      rowsDone,
      bytesDone,
      bytesTotal: options.bytesTotal ?? null,
    });
  }
  if (!checked) throw new NotZipError();
  unzip.push(new Uint8Array(0), true);
  batcher.commit();

  for (const def of GTFS_TABLES) {
    if (def.requiredFile && !seen.has(def.file)) {
      issues.add({
        severity: 'fatal',
        file: def.file,
        line: null,
        column: null,
        code: 'missing_file',
        message: `Required file ${def.file} is missing.`,
      });
    }
  }
  if (!seen.has('calendar.txt') && !seen.has('calendar_dates.txt')) {
    issues.add({
      severity: 'fatal',
      file: null,
      line: null,
      column: null,
      code: 'missing_calendar',
      message: 'Either calendar.txt or calendar_dates.txt is required.',
    });
  }

  const fatal = issues.hasFatal();
  if (!fatal) {
    options.onProgress?.({stage: 'index'});
    createGtfsIndexes(db);
  }
  return {filesLoaded, fatal};
}
