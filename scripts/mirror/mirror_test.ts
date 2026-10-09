import {strToU8} from 'fflate';
import {beforeEach, describe, expect, it} from 'vitest';
import {makeZip, SAMPLE_FEED} from '../../src/test-fixtures/sample-feed.ts';
import type {CatalogEntry} from '../../src/catalog/catalog-types.ts';
import {checkGtfsZip, mirrorCatalog, type ObjectStore} from './mirror.ts';

class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly puts: string[] = [];

  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
    this.puts.push(key);
  }

  async getText(key: string): Promise<string | null> {
    const body = this.objects.get(key);
    return body === undefined ? null : new TextDecoder().decode(body);
  }
}

const CATALOG: CatalogEntry[] = [
  {id: 'good', name: 'Good', region: 'A', sourceUrl: 'https://a.test/good.zip'},
  {id: 'bad', name: 'Bad', region: 'B', sourceUrl: 'https://b.test/bad.zip'},
];
const ZIP = makeZip(SAMPLE_FEED);

describe('mirrorCatalog', () => {
  let store: MemoryObjectStore;
  let responses: Record<string, () => Response>;

  beforeEach(() => {
    store = new MemoryObjectStore();
    responses = {
      'https://a.test/good.zip': () => new Response(new Uint8Array(ZIP)),
      'https://b.test/bad.zip': () => new Response('nope', {status: 500}),
    };
  });

  const run = (catalog = CATALOG): ReturnType<typeof mirrorCatalog> =>
    mirrorCatalog(catalog, {
      fetch: async (url) => {
        const make = responses[url];
        if (make === undefined) throw new TypeError('fetch failed');
        return make();
      },
      store,
      now: () => new Date('2026-10-09T09:17:00Z'),
      log: () => {},
    });

  it('uploads good feeds, records failures, and writes catalog files', async () => {
    const report = await run();
    expect(report.failures).toEqual(['bad']);
    expect(report.lock.feeds['good']).toMatchObject({size: ZIP.length, lastError: null});
    expect(report.lock.feeds['good']?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.lock.feeds['bad']).toMatchObject({sha256: null, lastError: 'HTTP 500'});
    expect([...store.objects.keys()].sort()).toEqual(['catalog.json', 'catalog.lock.json', 'feeds/good.zip']);
  });

  it('keeps the previous mirror when a feed later fails', async () => {
    await run();
    responses['https://a.test/good.zip'] = () => new Response('down', {status: 503});
    const report = await run();
    expect(report.lock.feeds['good']).toMatchObject({size: ZIP.length, lastError: 'HTTP 503'});
    expect(report.lock.feeds['good']?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips re-uploading unchanged zips', async () => {
    await run();
    store.puts.length = 0;
    await run();
    expect(store.puts).not.toContain('feeds/good.zip');
  });

  it('rejects downloads that are not GTFS zips', async () => {
    responses['https://a.test/good.zip'] = () => new Response('<html>login</html>');
    const report = await run();
    expect(report.lock.feeds['good']?.lastError).toBe('not a valid zip archive');
  });
});

describe('checkGtfsZip', () => {
  it('requires a zip containing stops.txt', () => {
    expect(checkGtfsZip(ZIP)).toBeNull();
    expect(checkGtfsZip(makeZip({'readme.txt': 'hi'}))).toBe('zip does not contain stops.txt');
    expect(checkGtfsZip(strToU8('not a zip'))).toBe('not a valid zip archive');
  });
});
