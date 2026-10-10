import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {parseCatalogSnapshot, parseCuratedCatalog} from '../../src/catalog/catalog-types.ts';
import type {CatalogEntry, CuratedEntry} from '../../src/catalog/catalog-types.ts';
import {mapMobilityDatabaseRows, rowsFromCsv, type MappedRows} from './mdb.ts';
import {mergeCatalog} from './merge.ts';

const MDB_URL = process.env['CATALOG_MDB_URL'] ?? 'https://files.mobilitydatabase.org/feeds_v2.csv';
const CURATED_PATH = 'catalog/catalog.json';
const SNAPSHOT_PATH = 'catalog/mdb-snapshot.json';
const OUTPUT_PATH = 'public/catalog.json';

function fail(message: string): never {
  console.error(`catalog:sync: ${message}`);
  process.exit(1);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function downloadEntries(): Promise<MappedRows> {
  const response = await fetch(MDB_URL, {signal: AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${MDB_URL}`);
  return mapMobilityDatabaseRows(rowsFromCsv(await response.text()));
}

function readSnapshot(): CatalogEntry[] {
  if (!existsSync(SNAPSHOT_PATH)) fail(`${SNAPSHOT_PATH} is missing and the download failed`);
  try {
    const parsed: unknown = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    return [...parseCatalogSnapshot({generatedAt: 'snapshot', entries: parsed}).entries];
  } catch (error) {
    return fail(`${SNAPSHOT_PATH} is unusable (${message(error)})`);
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--if-missing') && existsSync(OUTPUT_PATH)) return;

  let curated: CuratedEntry[];
  try {
    curated = parseCuratedCatalog(JSON.parse(readFileSync(CURATED_PATH, 'utf8')));
  } catch (error) {
    return fail(message(error));
  }

  let mdb: CatalogEntry[];
  let downloaded = false;
  let skipped = 0;
  try {
    const mapped = await downloadEntries();
    mdb = mapped.entries;
    skipped = mapped.skipped.invalidId + mapped.skipped.duplicateId;
    downloaded = true;
  } catch (error) {
    console.error(`catalog:sync: using ${SNAPSHOT_PATH} (${message(error)})`);
    mdb = readSnapshot();
  }

  let entries: CatalogEntry[];
  try {
    entries = mergeCatalog(mdb, curated);
  } catch (error) {
    return fail(message(error));
  }

  mkdirSync(dirname(OUTPUT_PATH), {recursive: true});
  writeFileSync(OUTPUT_PATH, JSON.stringify({generatedAt: new Date().toISOString(), entries}));
  if (args.has('--update-snapshot') && downloaded) writeFileSync(SNAPSHOT_PATH, JSON.stringify(mdb));
  if (skipped > 0) console.error(`catalog:sync: skipped ${skipped} rows with unusable ids`);
  console.log(`catalog:sync: ${entries.length} feeds (${entries.filter((e) => e.featured).length} featured)`);
}

await main();
