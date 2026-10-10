import {describe, expect, it} from 'vitest';
import type {FeedRecord} from '../shared/types.ts';
import type {Access, CatalogEntry} from './catalog-types.ts';
import {checkForUpdate} from './update-check.ts';

function entry(access: Access = {kind: 'direct'}): CatalogEntry {
  return {
    id: 'x',
    name: 'X',
    place: 'Y',
    url: 'https://example.com/feed.zip',
    originalUrl: null,
    access,
    license: null,
    bbox: null,
    featured: false,
    viaMobilityDatabase: false,
  };
}

function record(etag: string | null, lastModified: string | null): FeedRecord {
  return {
    id: 'x',
    name: 'X',
    sourceKind: 'catalog',
    sourceRef: 'x',
    sourceEtag: etag,
    sourceLastModified: lastModified,
    license: null,
    viaMobilityDatabase: false,
    importedAt: '2026-01-01T00:00:00Z',
    serviceStart: null,
    serviceEnd: null,
    dbFilename: 'x.db',
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(response: Response | Error): {calls: Call[]; fn: (url: string, init: RequestInit) => Promise<Response>} {
  const calls: Call[] = [];
  return {
    calls,
    fn: async (url, init) => {
      calls.push({url, init});
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

const keyAccess: Access = {
  kind: 'key',
  provider: 'p',
  signupUrl: 'https://example.com/signup',
  queryParam: 'api_key',
  header: null,
};

describe('checkForUpdate', () => {
  it('is current when the ETag matches, using a keyed HEAD request', async () => {
    const f = fakeFetch(new Response(null, {headers: {ETag: '"abc"'}}));
    const status = await checkForUpdate(entry(keyAccess), record('"abc"', null), 'k1', f.fn);
    expect(status).toBe('current');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.init.method).toBe('HEAD');
    expect(f.calls[0]?.url).toBe('https://example.com/feed.zip?api_key=k1');
  });

  it('is an update when the ETag differs', async () => {
    const f = fakeFetch(new Response(null, {headers: {ETag: '"new"'}}));
    expect(await checkForUpdate(entry(), record('"old"', null), null, f.fn)).toBe('update');
  });

  it('ignores the weak validator prefix', async () => {
    const f = fakeFetch(new Response(null, {headers: {ETag: 'W/"abc"'}}));
    expect(await checkForUpdate(entry(), record('"abc"', null), null, f.fn)).toBe('current');
  });

  it('falls back to Last-Modified when there is no ETag', async () => {
    const f = fakeFetch(new Response(null, {headers: {'Last-Modified': 'Tue, 02 Jan 2026 00:00:00 GMT'}}));
    const old = 'Mon, 01 Jan 2026 00:00:00 GMT';
    expect(await checkForUpdate(entry(), record(null, old), null, f.fn)).toBe('update');
    const same = fakeFetch(new Response(null, {headers: {'Last-Modified': old}}));
    expect(await checkForUpdate(entry(), record(null, old), null, same.fn)).toBe('current');
  });

  it('is unknown without stored validators and does not fetch', async () => {
    const f = fakeFetch(new Response(null));
    expect(await checkForUpdate(entry(), record(null, null), null, f.fn)).toBe('unknown');
    expect(f.calls).toHaveLength(0);
  });

  it('is unknown for download access without fetching', async () => {
    const f = fakeFetch(new Response(null));
    const e = entry({kind: 'download', pageUrl: null});
    expect(await checkForUpdate(e, record('"a"', null), null, f.fn)).toBe('unknown');
    expect(f.calls).toHaveLength(0);
  });

  it('is unknown for key access without a key and does not fetch', async () => {
    const f = fakeFetch(new Response(null));
    expect(await checkForUpdate(entry(keyAccess), record('"a"', null), null, f.fn)).toBe('unknown');
    expect(f.calls).toHaveLength(0);
  });

  it('is unknown when the request fails', async () => {
    const f = fakeFetch(new Error('offline'));
    expect(await checkForUpdate(entry(), record('"a"', null), null, f.fn)).toBe('unknown');
  });

  it('is unknown when HEAD is not allowed', async () => {
    const f = fakeFetch(new Response(null, {status: 405, headers: {ETag: '"b"'}}));
    expect(await checkForUpdate(entry(), record('"a"', null), null, f.fn)).toBe('unknown');
  });

  it('is unknown when the response has no validators', async () => {
    const f = fakeFetch(new Response(null));
    expect(await checkForUpdate(entry(), record('"a"', null), null, f.fn)).toBe('unknown');
  });
});
