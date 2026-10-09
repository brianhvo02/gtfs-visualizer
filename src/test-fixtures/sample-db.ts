import {createGtfsTables} from '../worker/ddl.ts';
import {buildDerivedTables} from '../worker/derive.ts';
import {IssueCollector} from '../worker/issues.ts';
import {loadGtfsZip} from '../worker/loader.ts';
import type {Database} from '../worker/sqlite.ts';
import {makeZip, SAMPLE_FEED, streamOf} from './sample-feed.ts';
import {openMemoryDb} from './test-db.ts';

/** Loads a feed into a fresh in-memory DB and builds derived tables. */
export async function loadSampleDb(
  files: Readonly<Record<string, string>> = SAMPLE_FEED,
): Promise<{db: Database; issues: IssueCollector}> {
  const db = await openMemoryDb();
  createGtfsTables(db);
  const issues = new IssueCollector(db);
  const result = await loadGtfsZip(db, streamOf(makeZip(files)), issues);
  if (result.fatal) throw new Error('sample feed failed to load');
  buildDerivedTables(db, issues);
  return {db, issues};
}
