import {describe, expect, it} from 'vitest';
import type {CatalogEntry} from './catalog-types.ts';
import {probeFeed} from './probe.ts';

const entry: CatalogEntry = {
  id: 'demo',
  name: 'Demo',
  place: 'Testland',
  url: 'https://api.test/feed.zip',
  originalUrl: null,
  access: {kind: 'key', provider: 'api.test', signupUrl: 'https://api.test/signup', queryParam: 'api_key', header: null},
  license: null,
  bbox: null,
  featured: false,
  viaMobilityDatabase: false,
};

describe('probeFeed', () => {
  it('sends a keyed GET (some hosts only allow CORS on GET), returns headers, and cancels the body', async () => {
    let seen: {url: string; init: RequestInit} | null = null;
    const response = new Response('zip bytes', {status: 200, headers: {'content-length': '9', etag: '"v1"'}});
    const headers = await probeFeed(entry, 'k', async (url, init) => {
      seen = {url, init};
      return response;
    });
    expect(headers?.get('ETag')).toBe('"v1"');
    expect(seen).toMatchObject({url: 'https://api.test/feed.zip?api_key=k', init: {method: 'GET', cache: 'no-cache'}});
    expect((seen as {init: RequestInit} | null)?.init.signal?.aborted).toBe(true);
  });

  it('returns null on a network error or a non-OK status', async () => {
    expect(await probeFeed(entry, 'k', async () => Promise.reject(new TypeError('Failed to fetch')))).toBeNull();
    expect(await probeFeed(entry, 'k', async () => new Response(null, {status: 401}))).toBeNull();
  });
});
