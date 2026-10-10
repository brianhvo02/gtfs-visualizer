import {describe, expect, it} from 'vitest';
import type {CatalogEntry} from './catalog-types.ts';
import {fetchFeedSize} from './feed-size.ts';

const direct: CatalogEntry = {
  id: 'demo',
  name: 'Demo',
  place: 'Testland',
  url: 'https://feeds.test/demo.zip',
  originalUrl: null,
  access: {kind: 'direct'},
  license: null,
  bbox: null,
  featured: false,
  viaMobilityDatabase: false,
  official: true,
};

const keyed: CatalogEntry = {
  ...direct,
  url: 'https://api.test/feed.zip',
  access: {kind: 'key', provider: 'api.test', signupUrl: 'https://api.test/signup', queryParam: 'api_key', header: null},
};

function fakeFetch(response: Response | Error): {
  calls: Array<{url: string; init: RequestInit}>;
  fn: (url: string, init: RequestInit) => Promise<Response>;
} {
  const calls: Array<{url: string; init: RequestInit}> = [];
  return {
    calls,
    fn: async (url, init) => {
      calls.push({url, init});
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

describe('fetchFeedSize', () => {
  it('reads Content-Length without downloading', async () => {
    const fake = fakeFetch(new Response(null, {status: 200, headers: {'content-length': '13763966'}}));
    expect(await fetchFeedSize(direct, null, fake.fn)).toBe(13763966);
    expect(fake.calls).toEqual([{url: 'https://feeds.test/demo.zip', init: expect.objectContaining({method: 'GET'})}]);
  });

  it('adds the key the same way imports do', async () => {
    const fake = fakeFetch(new Response(null, {status: 200, headers: {'content-length': '10'}}));
    await fetchFeedSize(keyed, 'k 1', fake.fn);
    expect(fake.calls[0]?.url).toBe('https://api.test/feed.zip?api_key=k%201');
  });

  it('returns null when the size is unknown or the request fails', async () => {
    expect(await fetchFeedSize(direct, null, fakeFetch(new Response(null, {status: 200})).fn)).toBeNull();
    expect(await fetchFeedSize(direct, null, fakeFetch(new Response(null, {status: 404})).fn)).toBeNull();
    expect(await fetchFeedSize(direct, null, fakeFetch(new TypeError('Failed to fetch')).fn)).toBeNull();
    const bogus = new Response(null, {status: 200, headers: {'content-length': 'abc'}});
    expect(await fetchFeedSize(direct, null, fakeFetch(bogus).fn)).toBeNull();
  });

  it('skips download-only entries and keyed entries without a key', async () => {
    const download = fakeFetch(new Response(null, {status: 200, headers: {'content-length': '10'}}));
    expect(await fetchFeedSize({...direct, access: {kind: 'download', pageUrl: null}}, null, download.fn)).toBeNull();
    const noKey = fakeFetch(new Response(null, {status: 200, headers: {'content-length': '10'}}));
    expect(await fetchFeedSize(keyed, null, noKey.fn)).toBeNull();
    expect(download.calls).toHaveLength(0);
    expect(noKey.calls).toHaveLength(0);
  });
});
