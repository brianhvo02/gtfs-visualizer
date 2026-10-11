import {strToU8} from 'fflate';
import {beforeEach, describe, expect, it} from 'vitest';
import type {CatalogEntry} from '../catalog/catalog-types.ts';
import type {ImportProgress, ImportResult} from '../shared/types.ts';
import type {ValidationProgress} from '../shared/validation.ts';
import {ClosingMemoryFeedStore} from '../test-fixtures/closing-feed-store.ts';
import {makeZip, SAMPLE_FEED, VALID_FEED, withoutFile} from '../test-fixtures/sample-feed.ts';
import {FeedService, META_FILENAME, slugify} from './feed-service.ts';
import {MemoryFeedStore} from './feed-store.ts';
import {loadSqlite} from './sqlite.ts';

const NOW = new Date('2026-10-09T12:00:00Z');
const KEY = 'SECRETKEY123';

function catalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'Demo_Feed',
    name: 'Demo (catalog)',
    place: 'Demoville',
    url: 'https://api.test/demo.zip',
    originalUrl: null,
    access: {kind: 'direct'},
    license: 'CC-BY-4.0',
    bbox: null,
    featured: false,
    viaMobilityDatabase: true,
    official: true,
    ...overrides,
  };
}

const keyedEntry = (queryParam: string | null = 'consumerKey', header: string | null = null): CatalogEntry =>
  catalogEntry({
    access: {kind: 'key', provider: 'P', signupUrl: 'https://p.test', queryParam, header},
  });

/** Copies into an ArrayBuffer-backed array so the bytes satisfy DOM BlobPart/BodyInit types. */
function zipBytes(files = SAMPLE_FEED): Uint8Array<ArrayBuffer> {
  return new Uint8Array(makeZip(files));
}

function zipFile(name: string, files = SAMPLE_FEED): File {
  return new File([zipBytes(files)], name, {type: 'application/zip'});
}

describe('FeedService', () => {
  let store: ClosingMemoryFeedStore;
  let service: FeedService;
  let fetchImpl: (url: string) => Promise<Response>;
  let fetchInits: Array<RequestInit | undefined>;
  let fetchUrls: string[];
  let clock: number;

  beforeEach(async () => {
    store = new ClosingMemoryFeedStore(await loadSqlite());
    fetchImpl = async () => new Response(zipBytes());
    fetchInits = [];
    fetchUrls = [];
    clock = NOW.getTime();
    service = new FeedService(store, {
      fetch: (url, init) => {
        fetchInits.push(init);
        fetchUrls.push(url);
        return fetchImpl(url);
      },
      now: () => new Date(clock++),
      estimate: async () => ({quota: 1000, usage: 400}),
    });
    service.init();
  });

  const importFile = (name = 'demo-transit.zip', files = SAMPLE_FEED): Promise<ImportResult> =>
    service.importFeed({kind: 'file', file: zipFile(name, files)}, () => {});

  it('imports an uploaded file and registers it', async () => {
    const progress: ImportProgress[] = [];
    const result = await service.importFeed(
      {kind: 'file', file: zipFile('demo-transit.zip')},
      (p) => progress.push(p),
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.feed).toMatchObject({
      id: 'file-demo-transit',
      name: 'Demo Transit Authority',
      sourceKind: 'file',
      sourceRef: 'demo-transit.zip',
      serviceStart: '20260101',
      serviceEnd: '20261231',
    });
    expect(service.listFeeds()).toEqual([result.feed]);
    expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(['parse', 'index', 'derive', 'register']));
    expect(service.getRoutes('file-demo-transit', null).map((r) => r.routeId)).toEqual(['R10', 'R20', 'R30']);
  });

  it('imports a catalog entry with its name, license, and source validators', async () => {
    fetchImpl = async () =>
      new Response(zipBytes(), {
        headers: {etag: '"abc"', 'last-modified': 'Mon, 05 Oct 2026 18:31:43 GMT'},
      });
    const entry = catalogEntry();
    const result = await service.importFeed({kind: 'catalog', entry, key: null}, () => {});
    if (!result.ok) throw new Error(result.message);
    expect(result.feed).toMatchObject({
      id: 'Demo_Feed',
      name: entry.name,
      sourceKind: 'catalog',
      sourceRef: 'Demo_Feed',
      viaMobilityDatabase: true,
      license: 'CC-BY-4.0',
      sourceEtag: '"abc"',
      sourceLastModified: 'Mon, 05 Oct 2026 18:31:43 GMT',
    });
    expect(fetchInits[0]).toMatchObject({cache: 'no-cache'});
    expect(service.listFeeds()).toEqual([result.feed]);
  });

  it('calls a keyed URL with the key and never saves it', async () => {
    const result = await service.importFeed({kind: 'catalog', entry: keyedEntry(), key: KEY}, () => {});
    if (!result.ok) throw new Error(result.message);
    expect(fetchUrls[0]).toBe(`https://api.test/demo.zip?consumerKey=${KEY}`);
    expect(JSON.stringify(service.listFeeds())).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('sends a header key as a request header', async () => {
    await service.importFeed({kind: 'catalog', entry: keyedEntry(null, 'X-Api-Key'), key: KEY}, () => {});
    expect(fetchInits[0]).toMatchObject({headers: {'X-Api-Key': KEY}});
    expect(fetchUrls[0]).toBe('https://api.test/demo.zip');
  });

  it.each([401, 403])('maps HTTP %i on a keyed entry to key_rejected without leaking the key', async (status) => {
    fetchImpl = async () => new Response('no', {status});
    const result = await service.importFeed({kind: 'catalog', entry: keyedEntry(), key: KEY}, () => {});
    expect(result).toMatchObject({ok: false, code: 'key_rejected', message: 'The provider rejected this key.'});
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${KEY}|consumerKey`));
  });

  it('maps HTTP 404 on a keyed entry to http without leaking the key', async () => {
    fetchImpl = async () => new Response('no', {status: 404});
    const result = await service.importFeed({kind: 'catalog', entry: keyedEntry(), key: KEY}, () => {});
    expect(result).toMatchObject({ok: false, code: 'http'});
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${KEY}|consumerKey`));
  });

  it('maps a TypeError on a catalog entry to blocked without leaking the key', async () => {
    fetchImpl = async (url) => {
      throw new TypeError(`Failed to fetch ${url}`);
    };
    const result = await service.importFeed({kind: 'catalog', entry: keyedEntry(), key: KEY}, () => {});
    expect(result).toMatchObject({
      ok: false,
      code: 'blocked',
      message: "Your browser couldn't download this feed directly.",
    });
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${KEY}|consumerKey`));
  });

  it('maps a mid-download TypeError on a catalog entry to blocked', async () => {
    fetchImpl = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new TypeError('network error'));
          },
        }),
      );
    const result = await service.importFeed({kind: 'catalog', entry: catalogEntry(), key: null}, () => {});
    expect(result).toMatchObject({ok: false, code: 'blocked'});
  });

  it('does not leak the key when the response is not a zip', async () => {
    fetchImpl = async () => new Response('<html>nope</html>');
    const result = await service.importFeed({kind: 'catalog', entry: keyedEntry(), key: KEY}, () => {});
    expect(result).toMatchObject({ok: false, code: 'not_zip'});
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${KEY}|consumerKey`));
  });

  it('imports a downloaded file under the catalog id and name', async () => {
    const entry = catalogEntry({access: {kind: 'download', pageUrl: null}});
    const result = await service.importFeed({kind: 'catalog-file', entry, file: zipFile('whatever.zip')}, () => {});
    if (!result.ok) throw new Error(result.message);
    expect(result.feed).toMatchObject({id: 'Demo_Feed', name: entry.name, sourceKind: 'catalog', sourceEtag: null});
  });

  it('migrates an older feeds table', async () => {
    const old = new MemoryFeedStore(await loadSqlite());
    const meta = old.open(META_FILENAME);
    meta.exec(`CREATE TABLE feeds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, source_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
      catalog_sha256 TEXT, imported_at TEXT NOT NULL, service_start TEXT, service_end TEXT, db_filename TEXT NOT NULL)`);
    meta.exec(`INSERT INTO feeds VALUES ('old', 'Old', 'url', 'https://x.test/a.zip', NULL, '2026-01-01T00:00:00Z', NULL, NULL, '/feeds/old-1.db')`);
    old.close(META_FILENAME);
    const migrated = new FeedService(old, {fetch: fetchImpl, now: () => NOW, estimate: async () => ({})});
    migrated.init();
    expect(migrated.listFeeds()).toEqual([
      expect.objectContaining({
        id: 'old',
        sourceEtag: null,
        sourceLastModified: null,
        license: null,
        viaMobilityDatabase: false,
      }),
    ]);
  });

  it('derives an id from a URL', async () => {
    const result = await service.importFeed({kind: 'url', url: 'https://agency.example.com/gtfs/feed.zip'}, () => {});
    if (!result.ok) throw new Error(result.message);
    expect(result.feed.id).toBe('url-agency-example-com-gtfs-feed-zip');
  });

  it('explains network (CORS) failures', async () => {
    fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const result = await service.importFeed({kind: 'url', url: 'https://blocked.test/feed.zip'}, () => {});
    expect(result).toMatchObject({ok: false, code: 'network'});
    expect(result.ok ? '' : result.message).toMatch(/upload/i);
  });

  it('reports HTTP errors', async () => {
    fetchImpl = async () => new Response('nope', {status: 404});
    const result = await service.importFeed({kind: 'url', url: 'https://x.test/feed.zip'}, () => {});
    expect(result).toMatchObject({ok: false, code: 'http'});
  });

  it('rejects non-zip files and leaves nothing behind', async () => {
    const file = new File([strToU8('stop_id\n1\n')], 'stops.txt');
    const result = await service.importFeed({kind: 'file', file}, () => {});
    expect(result).toMatchObject({ok: false, code: 'not_zip'});
    expect(store.list()).toEqual([META_FILENAME]);
  });

  it('returns fatal issues and leaves nothing behind', async () => {
    const result = await importFile('broken.zip', withoutFile('stops.txt'));
    expect(result).toMatchObject({ok: false, code: 'fatal_issues'});
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual(['missing_file']);
    expect(store.list()).toEqual([META_FILENAME]);
    expect(service.listFeeds()).toEqual([]);
  });

  it('replaces a feed on re-import of the same URL and removes the old database', async () => {
    const url = { kind: 'url', url: 'https://agency.example.com/gtfs/feed.zip' } as const;
    const first = await service.importFeed(url, () => {});
    const second = await service.importFeed(url, () => {});
    if (!first.ok || !second.ok) throw new Error('import failed');
    expect(second.feed.dbFilename).not.toBe(first.feed.dbFilename);
    expect(service.listFeeds()).toHaveLength(1);
    expect(store.list().sort()).toEqual([META_FILENAME, second.feed.dbFilename].sort());
  });

  it('opens, queries, and deletes feeds', async () => {
    const result = await importFile();
    if (!result.ok) throw new Error(result.message);
    expect(service.openFeed('file-demo-transit')).toEqual(result.feed);
    expect(service.openFeed('missing')).toBeNull();
    expect(service.getStopDetail('file-demo-transit', 'STN', null)?.routes).toHaveLength(2);
    service.deleteFeed('file-demo-transit');
    expect(service.listFeeds()).toEqual([]);
    expect(store.list()).toEqual([META_FILENAME]);
    expect(() => service.getRoutes('file-demo-transit', null)).toThrow('Feed not found: file-demo-transit');
  });

  it('removes orphaned feed databases at startup', async () => {
    store.open('/feeds/orphan-1.db');
    service.init();
    expect(store.list()).toEqual([META_FILENAME]);
  });

  it('checks storage headroom at the shared multiple of the download size', async () => {
    expect(await service.checkStorage(20)).toEqual({ok: true, availableBytes: 600});
    expect(await service.checkStorage(21)).toEqual({ok: false, availableBytes: 600});
  });

  it('never replaces a saved feed with an upload of the same name', async () => {
    const first = await importFile('gtfs.zip');
    const second = await importFile('gtfs.zip');
    if (!first.ok || !second.ok) throw new Error('import failed');
    expect([first.feed.id, second.feed.id]).toEqual(['file-gtfs', 'file-gtfs-2']);
    expect(service.listFeeds()).toHaveLength(2);
  });

  it('does not let an upload replace a catalog feed with the same slug', async () => {
    const catalog = await service.importFeed(
      {kind: 'catalog', entry: catalogEntry({id: 'mbta', name: 'MBTA'}), key: null},
      () => {},
    );
    const upload = await importFile('mbta.zip');
    if (!catalog.ok || !upload.ok) throw new Error('import failed');
    expect(upload.feed.id).toBe('file-mbta');
    expect(service.listFeeds().map((f) => f.id).sort()).toEqual(['file-mbta', 'mbta']);
  });

  it('gives URLs that differ only in the query string different ids', async () => {
    const a = await service.importFeed({kind: 'url', url: 'https://x.test/feed?agency=a'}, () => {});
    const b = await service.importFeed({kind: 'url', url: 'https://x.test/feed?agency=b'}, () => {});
    if (!a.ok || !b.ok) throw new Error('import failed');
    expect(a.feed.id).not.toBe(b.feed.id);
    expect(service.listFeeds()).toHaveLength(2);
  });

  it('maps a mid-download network failure to the network error and leaves nothing behind', async () => {
    const bytes = zipBytes();
    fetchImpl = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, 20));
          },
          pull(controller) {
            controller.error(new TypeError('network error'));
          },
        }),
      );
    const result = await service.importFeed({kind: 'url', url: 'https://x.test/feed.zip'}, () => {});
    expect(result).toMatchObject({ok: false, code: 'network'});
    expect(result.ok ? '' : result.message).toMatch(/upload/i);
    expect(store.list()).toEqual([META_FILENAME]);
  });

  it('keeps an existing feed untouched when a re-import fails', async () => {
    const url = {kind: 'url', url: 'https://agency.example.com/gtfs/feed.zip'} as const;
    const first = await service.importFeed(url, () => {});
    if (!first.ok) throw new Error('import failed');
    const feedsBefore = service.listFeeds();
    const filesBefore = store.list().sort();
    fetchImpl = async () => new Response(zipBytes(withoutFile('stops.txt')));
    const second = await service.importFeed(url, () => {});
    expect(second).toMatchObject({ok: false, code: 'fatal_issues'});
    expect(service.listFeeds()).toEqual(feedsBefore);
    expect(store.list().sort()).toEqual(filesBefore);
    expect(service.getRoutes(first.feed.id, null).map((r) => r.routeId)).toEqual(['R10', 'R20', 'R30']);
  });

  describe('validation', () => {
    const importId = async (name: string, files = SAMPLE_FEED): Promise<string> => {
      const result = await importFile(name, files);
      if (!result.ok) throw new Error(result.message);
      return result.feed.id;
    };

    it('validates an imported feed and then reports results as current', async () => {
      const id = await importId('demo.zip');
      const progress: ValidationProgress[] = [];
      const status = await service.ensureValidation(id, (p) => progress.push(p));
      expect(status).toEqual({state: 'current', counts: {error: 0, warning: 3, info: 0}});
      expect(progress).toHaveLength(6);
      const again: ValidationProgress[] = [];
      expect(await service.ensureValidation(id, (p) => again.push(p))).toEqual(status);
      expect(again).toEqual([]);
    });

    it('joins a run already in progress', async () => {
      const id = await importId('demo.zip');
      const a: ValidationProgress[] = [];
      const b: ValidationProgress[] = [];
      const first = service.ensureValidation(id, (p) => a.push(p));
      const second = service.ensureValidation(id, (p) => b.push(p));
      const [one, two] = await Promise.all([first, second]);
      expect(one).toBe(two);
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
    });

    it('cancels a run when another feed is opened', async () => {
      const a = await importId('feed-a.zip');
      const b = await importId('feed-b.zip', VALID_FEED);
      const run = service.ensureValidation(a, () => {});
      service.openFeed(b);
      expect(await run).toEqual({state: 'cancelled'});
      expect(await service.ensureValidation(b, () => {})).toMatchObject({state: 'current'});
      expect(await service.ensureValidation(a, () => {})).toMatchObject({state: 'current'});
    });

    it('reads nothing before the first run, like a feed imported before validation existed', async () => {
      const id = await importId('demo.zip');
      expect(service.getValidationSummary(id)).toBeNull();
      expect(service.getValidationIssues(id, {routeId: 'R10'})).toEqual([]);
      expect(await service.ensureValidation(id, () => {})).toMatchObject({state: 'current'});
      expect(service.getValidationSummary(id)).not.toBeNull();
    });

    it('returns issues for a station including its platforms', async () => {
      const id = await importId('demo.zip');
      await service.ensureValidation(id, () => {});
      const issues = service.getValidationIssues(id, {stopId: 'STN'});
      expect(issues.some((i) => i.stopId === 'STN_A' && i.details?.['toStopId'] === 'NADAV')).toBe(true);
    });

    it('survives a failing progress listener', async () => {
      const id = await importId('demo.zip');
      const status = await service.ensureValidation(id, () => {
        throw new Error('listener failed');
      });
      expect(status).toMatchObject({state: 'current'});
    });

    it('cancels a run when its feed is deleted', async () => {
      const id = await importId('demo.zip');
      const run = service.ensureValidation(id, () => {});
      service.deleteFeed(id);
      expect(await run).toEqual({state: 'cancelled'});
    });

    it('cancels a run when its feed is replaced by a re-import', async () => {
      const source = {kind: 'url', url: 'https://agency.example.com/gtfs/feed.zip'} as const;
      const first = await service.importFeed(source, () => {});
      if (!first.ok) throw new Error(first.message);
      const run = service.ensureValidation(first.feed.id, () => {});
      const second = await service.importFeed(source, () => {});
      if (!second.ok) throw new Error(second.message);
      expect(await run).toEqual({state: 'cancelled'});
      expect(await service.ensureValidation(second.feed.id, () => {})).toMatchObject({state: 'current'});
    });
  });

  it('slugifies ids', () => {
    expect(slugify('Bay Area 511 (Regional)')).toBe('bay-area-511-regional');
    expect(slugify('!!!')).toBe('feed');
  });
});
