import type {FeatureCollection, LineString, Point} from 'geojson';
import type {
  Departure,
  FeedRecord,
  FeedSourceKind,
  FeedSummary,
  ImportErrorCode,
  ImportFailure,
  ImportProgress,
  ImportResult,
  ImportSource,
  RouteDetail,
  RouteShapeProps,
  RouteSummary,
  StopDetail,
  StopProps,
  StorageCheck,
} from '../shared/types.ts';
import {STORAGE_HEADROOM} from '../shared/storage.ts';
import {createGtfsTables} from './ddl.ts';
import {buildDerivedTables} from './derive.ts';
import type {FeedStore} from './feed-store.ts';
import {IssueCollector} from './issues.ts';
import {loadGtfsZip, NotZipError} from './loader.ts';
import * as queries from './queries.ts';
import type {Database} from './sqlite.ts';

export const META_FILENAME = '/meta.db';
const FEED_PREFIX = '/feeds/';
const CORS_MESSAGE =
  "Couldn't download the feed. The server may not allow downloads from other websites (CORS). " +
  'Download the zip yourself and upload it instead.';

export interface FeedServiceDeps {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly now: () => Date;
  readonly estimate: () => Promise<StorageEstimate>;
}

interface Acquired {
  readonly ok: true;
  readonly stream: ReadableStream<Uint8Array>;
  readonly bytesTotal: number | null;
  readonly id: string;
  readonly sourceKind: FeedSourceKind;
  readonly sourceRef: string;
  readonly fixedName: string | null;
  readonly fallbackName: string;
  readonly catalogSha256: string | null;
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug.length === 0 ? 'feed' : slug;
}

function failure(code: ImportErrorCode, message: string): ImportFailure {
  return {ok: false, code, message, issues: []};
}

function toFailure(error: unknown, source: ImportSource): ImportFailure {
  if (error instanceof TypeError && source.kind !== 'file') {
    // fetch() rejects its body stream with a TypeError when the connection drops mid-download.
    return failure('network', CORS_MESSAGE);
  }
  if (error instanceof NotZipError) {
    return failure('not_zip', "This file isn't a zip archive. GTFS feeds are distributed as .zip files.");
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/QuotaExceeded|SQLITE_FULL|disk is full|quota/i.test(message)) {
    return failure('quota', 'Ran out of browser storage while importing. Delete other feeds and try again.');
  }
  return failure('unknown', message);
}

function toRecord(row: Record<string, unknown>): FeedRecord {
  const text = (key: string): string | null => {
    const value = row[key];
    return typeof value === 'string' ? value : null;
  };
  const kind = text('source_kind');
  return {
    id: text('id') ?? '',
    name: text('name') ?? '',
    sourceKind: kind === 'catalog' || kind === 'url' ? kind : 'file',
    sourceRef: text('source_ref') ?? '',
    catalogSha256: text('catalog_sha256'),
    importedAt: text('imported_at') ?? '',
    serviceStart: text('service_start'),
    serviceEnd: text('service_end'),
    dbFilename: text('db_filename') ?? '',
  };
}

export class FeedService {
  private readonly store: FeedStore;
  private readonly deps: FeedServiceDeps;
  private meta: Database | null = null;
  private current: {readonly id: string; readonly filename: string; readonly db: Database} | null = null;

  constructor(store: FeedStore, deps: FeedServiceDeps) {
    this.store = store;
    this.deps = deps;
  }

  init(): void {
    const meta = this.store.open(META_FILENAME);
    meta.exec(`
      CREATE TABLE IF NOT EXISTS feeds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        catalog_sha256 TEXT,
        imported_at TEXT NOT NULL,
        service_start TEXT,
        service_end TEXT,
        db_filename TEXT NOT NULL
      )
    `);
    this.meta = meta;
    const referenced = new Set(this.listFeeds().map((feed) => feed.dbFilename));
    for (const name of this.store.list()) {
      if (name.startsWith(FEED_PREFIX) && name.endsWith('.db') && !referenced.has(name)) {
        this.store.remove(name);
      }
    }
  }

  listFeeds(): FeedRecord[] {
    return this.requireMeta().selectObjects('SELECT * FROM feeds ORDER BY name COLLATE NOCASE').map(toRecord);
  }

  openFeed(id: string): FeedRecord | null {
    const record = this.getRecord(id);
    if (record === null) return null;
    this.dbFor(id);
    return record;
  }

  deleteFeed(id: string): void {
    const record = this.getRecord(id);
    if (record === null) return;
    if (this.current?.id === id) this.closeCurrent();
    this.requireMeta().exec({sql: 'DELETE FROM feeds WHERE id = ?', bind: [id]});
    this.store.remove(record.dbFilename);
  }

  async checkStorage(bytes: number): Promise<StorageCheck> {
    const {quota, usage} = await this.deps.estimate();
    if (quota === undefined || usage === undefined) return {ok: true, availableBytes: null};
    const availableBytes = quota - usage;
    return {ok: availableBytes >= bytes * STORAGE_HEADROOM, availableBytes};
  }

  async importFeed(source: ImportSource, onProgress: (p: ImportProgress) => void): Promise<ImportResult> {
    const acquired = await this.acquire(source);
    if (!acquired.ok) return acquired;
    const filename = `${FEED_PREFIX}${acquired.id}-${this.deps.now().getTime()}.db`;
    try {
      await this.store.prepareForNewDb();
      const db = this.store.open(filename);
      db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;');
      createGtfsTables(db);
      const issues = new IssueCollector(db);
      const loaded = await loadGtfsZip(db, acquired.stream, issues, {
        onProgress,
        bytesTotal: acquired.bytesTotal,
      });
      if (loaded.fatal) {
        const fatal = issues.fatalIssues();
        this.store.remove(filename);
        return {
          ok: false,
          code: 'fatal_issues',
          message: fatal.map((issue) => issue.message).join('\n'),
          issues: fatal,
        };
      }
      onProgress({stage: 'derive'});
      buildDerivedTables(db, issues);
      issues.finish();
      db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
      onProgress({stage: 'register'});
      const summary = queries.getFeedSummary(db);
      this.store.close(filename);
      const record: FeedRecord = {
        id: acquired.id,
        name: acquired.fixedName ?? this.nameFromSummary(summary) ?? acquired.fallbackName,
        sourceKind: acquired.sourceKind,
        sourceRef: acquired.sourceRef,
        catalogSha256: acquired.catalogSha256,
        importedAt: this.deps.now().toISOString(),
        serviceStart: summary.serviceStart,
        serviceEnd: summary.serviceEnd,
        dbFilename: filename,
      };
      this.register(record);
      return {ok: true, feed: record, issueCount: issues.totalCount()};
    } catch (error) {
      this.store.remove(filename);
      return toFailure(error, source);
    }
  }

  getFeedSummary(feedId: string): FeedSummary {
    return queries.getFeedSummary(this.dbFor(feedId));
  }

  getRoutes(feedId: string): RouteSummary[] {
    return queries.getRoutes(this.dbFor(feedId));
  }

  getRouteShapesGeoJSON(feedId: string): FeatureCollection<LineString, RouteShapeProps> {
    return queries.getRouteShapesGeoJSON(this.dbFor(feedId));
  }

  getStopsGeoJSON(feedId: string): FeatureCollection<Point, StopProps> {
    return queries.getStopsGeoJSON(this.dbFor(feedId));
  }

  getRouteDetail(feedId: string, routeId: string): RouteDetail | null {
    return queries.getRouteDetail(this.dbFor(feedId), routeId);
  }

  getStopDetail(feedId: string, stopId: string): StopDetail | null {
    return queries.getStopDetail(this.dbFor(feedId), stopId);
  }

  getStopDepartures(feedId: string, stopId: string, serviceDate: string): Departure[] {
    return queries.getStopDepartures(this.dbFor(feedId), stopId, serviceDate);
  }

  private async acquire(source: ImportSource): Promise<Acquired | ImportFailure> {
    if (source.kind === 'file') {
      const base = source.file.name.replace(/\.zip$/i, '');
      return {
        ok: true,
        stream: source.file.stream(),
        bytesTotal: source.file.size,
        id: this.unusedId(`file-${slugify(base)}`),
        sourceKind: 'file',
        sourceRef: source.file.name,
        fixedName: null,
        fallbackName: base,
        catalogSha256: null,
      };
    }
    let response: Response;
    try {
      response =
        source.kind === 'catalog'
          ? await this.deps.fetch(source.url, {cache: 'no-cache'})
          : await this.deps.fetch(source.url);
    } catch {
      return failure('network', CORS_MESSAGE);
    }
    if (!response.ok || response.body === null) {
      return failure('http', `The server responded with HTTP ${response.status}.`);
    }
    const length = Number(response.headers.get('content-length'));
    const bytesTotal = Number.isFinite(length) && length > 0 ? length : null;
    if (source.kind === 'catalog') {
      return {
        ok: true,
        stream: response.body,
        bytesTotal,
        id: source.id,
        sourceKind: 'catalog',
        sourceRef: source.id,
        fixedName: source.name,
        fallbackName: source.name,
        catalogSha256: source.sha256,
      };
    }
    const url = new URL(source.url);
    return {
      ok: true,
      stream: response.body,
      bytesTotal,
      id: `url-${slugify(`${url.hostname}${url.pathname}${url.search}`)}`,
      sourceKind: 'url',
      sourceRef: source.url,
      fixedName: null,
      fallbackName: url.hostname,
      catalogSha256: null,
    };
  }

  /** Uploads never replace a saved feed: suffix -2, -3, ... until the id is free. */
  private unusedId(base: string): string {
    let id = base;
    for (let n = 2; this.getRecord(id) !== null; n++) id = `${base}-${n}`;
    return id;
  }

  private nameFromSummary(summary: FeedSummary): string | null {
    const names = summary.agencies.map((a) => a.name).filter((n) => n.length > 0);
    const first = names[0];
    if (first !== undefined) {
      return names.length === 1 ? first : `${first} + ${names.length - 1} more`;
    }
    return summary.feedInfo?.publisherName ?? null;
  }

  private register(record: FeedRecord): void {
    const previous = this.getRecord(record.id);
    this.requireMeta().exec({
      sql: `INSERT OR REPLACE INTO feeds
        (id, name, source_kind, source_ref, catalog_sha256, imported_at, service_start, service_end, db_filename)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [
        record.id,
        record.name,
        record.sourceKind,
        record.sourceRef,
        record.catalogSha256,
        record.importedAt,
        record.serviceStart,
        record.serviceEnd,
        record.dbFilename,
      ],
    });
    if (previous !== null && previous.dbFilename !== record.dbFilename) {
      if (this.current?.id === record.id) this.closeCurrent();
      this.store.remove(previous.dbFilename);
    }
  }

  private getRecord(id: string): FeedRecord | null {
    const row = this.requireMeta().selectObject('SELECT * FROM feeds WHERE id = ?', [id]);
    return row === undefined ? null : toRecord(row);
  }

  private dbFor(id: string): Database {
    if (this.current?.id === id) return this.current.db;
    const record = this.getRecord(id);
    if (record === null) throw new Error(`Feed not found: ${id}`);
    this.closeCurrent();
    const db = this.store.open(record.dbFilename);
    this.current = {id, filename: record.dbFilename, db};
    return db;
  }

  private closeCurrent(): void {
    if (this.current === null) return;
    this.store.close(this.current.filename);
    this.current = null;
  }

  private requireMeta(): Database {
    if (this.meta === null) throw new Error('FeedService.init() has not been called');
    return this.meta;
  }
}
