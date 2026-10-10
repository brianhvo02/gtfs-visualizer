import {openAsBlob} from 'node:fs';
import {createGtfsTables} from '../src/worker/ddl.ts';
import {buildDerivedTables} from '../src/worker/derive.ts';
import {IssueCollector} from '../src/worker/issues.ts';
import {loadGtfsZip} from '../src/worker/loader.ts';
import {getFeedLanguages, getMapLabels, getStopDepartures} from '../src/worker/queries.ts';
import {loadSqlite} from '../src/worker/sqlite.ts';

const path = process.argv[2];
if (path === undefined) {
  console.error('Usage: npm run perf -- <path/to/feed.zip>');
  process.exit(2);
}

const blob = await openAsBlob(path);
const sqlite3 = await loadSqlite();
const db = new sqlite3.oo1.DB(':memory:');
db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;');
createGtfsTables(db);
const issues = new IssueCollector(db);

const started = performance.now();
const result = await loadGtfsZip(db, blob.stream(), issues, {bytesTotal: blob.size});
const loaded = performance.now();
if (result.fatal) {
  console.error(issues.fatalIssues().map((issue) => issue.message).join('\n'));
  process.exit(1);
}
buildDerivedTables(db, issues);
issues.finish();
const derived = performance.now();

const pageCount = Number(db.selectValue('PRAGMA page_count'));
const pageSize = Number(db.selectValue('PRAGMA page_size'));
console.table({
  zipMB: (blob.size / 1e6).toFixed(1),
  stopTimes: Number(db.selectValue('SELECT count(*) FROM stop_times')),
  loadAndIndexSeconds: ((loaded - started) / 1000).toFixed(1),
  deriveSeconds: ((derived - loaded) / 1000).toFixed(1),
  totalSeconds: ((derived - started) / 1000).toFixed(1),
  dbMB: ((pageCount * pageSize) / 1e6).toFixed(1),
  issues: issues.totalCount(),
});

const {languages, originalLanguage} = getFeedLanguages(db);
const translated = languages.filter((language) => language !== originalLanguage);
const lang = translated[0];
const busiestStop = db.selectValue(
  'SELECT stop_id FROM stop_times GROUP BY stop_id ORDER BY count(*) DESC LIMIT 1',
);
const serviceStart = db.selectValue("SELECT value FROM feed_summary WHERE key = 'service_start'");
if (lang === undefined || typeof busiestStop !== 'string' || typeof serviceStart !== 'string') {
  console.log('No translations in this feed.');
} else {
  const time = (run: () => unknown): string => {
    const t0 = performance.now();
    run();
    return (performance.now() - t0).toFixed(1);
  };
  console.log(`Translated queries (language ${lang}, busiest stop ${busiestStop}, date ${serviceStart}):`);
  console.table({
    getMapLabelsMsOriginal: time(() => getMapLabels(db, null)),
    getMapLabelsMsTranslated: time(() => getMapLabels(db, lang)),
    getStopDeparturesMsOriginal: time(() => getStopDepartures(db, busiestStop, serviceStart, null)),
    getStopDeparturesMsTranslated: time(() => getStopDepartures(db, busiestStop, serviceStart, lang)),
  });
}
