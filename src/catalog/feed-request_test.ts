import {describe, expect, it} from 'vitest';
import type {Access, CatalogEntry} from './catalog-types.ts';
import {buildFeedRequest, redactUrl} from './feed-request.ts';

function entry(access: Access, url = 'https://api.test/f.zip'): CatalogEntry {
  return {
    id: 'x',
    name: 'X',
    place: 'Y',
    url,
    originalUrl: null,
    access,
    license: null,
    bbox: null,
    featured: false,
    viaMobilityDatabase: false,
    official: true,
  };
}

const keyAccess = (queryParam: string | null, header: string | null): Access => ({
  kind: 'key',
  provider: 'P',
  signupUrl: 'https://p.test',
  queryParam,
  header,
});

describe('buildFeedRequest', () => {
  it('uses the plain URL for direct access', () => {
    expect(buildFeedRequest(entry({kind: 'direct'}), null)).toEqual({url: 'https://api.test/f.zip', headers: {}});
  });

  it('appends the key as an encoded query parameter', () => {
    expect(buildFeedRequest(entry(keyAccess('acl:consumerKey', null)), 'a b').url).toBe(
      'https://api.test/f.zip?acl:consumerKey=a%20b',
    );
  });

  it('appends with & when the URL already has a query', () => {
    const request = buildFeedRequest(entry(keyAccess('acl:consumerKey', null), 'https://api.test/f.zip?x=1'), 'a b');
    expect(request.url).toBe('https://api.test/f.zip?x=1&acl:consumerKey=a%20b');
  });

  it('sends the key as a header', () => {
    expect(buildFeedRequest(entry(keyAccess(null, 'X-Api-Key')), 'k')).toEqual({
      url: 'https://api.test/f.zip',
      headers: {'X-Api-Key': 'k'},
    });
  });

  it('uses the plain URL for key access without a key', () => {
    expect(buildFeedRequest(entry(keyAccess('k', null)), null)).toEqual({url: 'https://api.test/f.zip', headers: {}});
  });
});

describe('redactUrl', () => {
  it('drops the query string', () => {
    expect(redactUrl('https://api.test/f.zip?acl:consumerKey=SECRET')).toBe('https://api.test/f.zip');
  });

  it('returns unparseable input unchanged', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});
