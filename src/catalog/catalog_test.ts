import {describe, expect, it} from 'vitest';
import type {FeedRecord} from '../shared/types.ts';
import {fetchCatalog, isUpdateAvailable, type CatalogFeed} from './catalog.ts';
import {parseCatalog} from './catalog-types.ts';

const CATALOG = [
  {id: 'mbta', name: 'MBTA', region: 'Boston', sourceUrl: 'https://cdn.mbta.com/MBTA_GTFS.zip'},
  {id: 'new-feed', name: 'New Feed', region: 'Nowhere', sourceUrl: 'https://x.test/gtfs.zip'},
];
const LOCK = {
  generatedAt: '2026-10-09T09:17:00Z',
  feeds: {
    mbta: {sha256: 'aaa', size: 100, fetchedAt: '2026-10-09T09:17:00Z', lastError: null, lastErrorAt: null},
  },
};

function fakeFetch(responses: Record<string, unknown>): (url: string) => Promise<Response> {
  return async (url) => {
    const body = responses[url];
    return body === undefined ? new Response('missing', {status: 404}) : Response.json(body);
  };
}

const RECORD: FeedRecord = {
  id: 'mbta',
  name: 'MBTA',
  sourceKind: 'catalog',
  sourceRef: 'mbta',
  catalogSha256: 'aaa',
  importedAt: '2026-10-01T00:00:00Z',
  serviceStart: null,
  serviceEnd: null,
  dbFilename: '/feeds/mbta-1.db',
};

describe('fetchCatalog', () => {
  it('merges the catalog with the lock file', async () => {
    const feeds = await fetchCatalog(
      'https://r2.test/',
      fakeFetch({'https://r2.test/catalog.json': CATALOG, 'https://r2.test/catalog.lock.json': LOCK}),
    );
    expect(feeds).toEqual([
      {...CATALOG[0], zipUrl: 'https://r2.test/feeds/mbta.zip', sha256: 'aaa', size: 100, fetchedAt: '2026-10-09T09:17:00Z', available: true},
      {...CATALOG[1], zipUrl: 'https://r2.test/feeds/new-feed.zip', sha256: null, size: null, fetchedAt: null, available: false},
    ]);
  });

  it('treats a missing lock file as nothing mirrored yet', async () => {
    const feeds = await fetchCatalog('https://r2.test', fakeFetch({'https://r2.test/catalog.json': CATALOG}));
    expect(feeds.every((f) => !f.available)).toBe(true);
  });

  it('throws when the catalog itself is unavailable', async () => {
    await expect(fetchCatalog('https://r2.test', fakeFetch({}))).rejects.toThrow('HTTP 404');
  });
});

describe('isUpdateAvailable', () => {
  const feed: CatalogFeed = {
    ...CATALOG[0],
    id: 'mbta',
    name: 'MBTA',
    region: 'Boston',
    sourceUrl: 'https://cdn.mbta.com/MBTA_GTFS.zip',
    zipUrl: 'https://r2.test/feeds/mbta.zip',
    sha256: 'bbb',
    size: 100,
    fetchedAt: null,
    available: true,
  };
  it('is true when the mirrored zip differs from the imported one', () => {
    expect(isUpdateAvailable(feed, RECORD)).toBe(true);
  });
  it('is false when checksums match or the feed is not imported from the catalog', () => {
    expect(isUpdateAvailable({...feed, sha256: 'aaa'}, RECORD)).toBe(false);
    expect(isUpdateAvailable(feed, undefined)).toBe(false);
    expect(isUpdateAvailable(feed, {...RECORD, sourceKind: 'url'})).toBe(false);
  });
});

describe('parseCatalog', () => {
  it('rejects invalid or duplicate ids', () => {
    expect(() => parseCatalog([{...CATALOG[0], id: 'Bad Id'}])).toThrow(/id/);
    expect(() => parseCatalog([CATALOG[0], CATALOG[0]])).toThrow(/duplicate/i);
    expect(() => parseCatalog({})).toThrow(/array/);
  });
});
