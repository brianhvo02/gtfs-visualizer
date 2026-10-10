import {describe, expect, it} from 'vitest';
import {parseCatalogSnapshot, parseCuratedCatalog} from './catalog-types.ts';

const TOKYO = {
  id: 'tokyo-metro',
  name: 'Tokyo Metro',
  place: 'Tokyo, Japan',
  url: 'https://api.odpt.org/api/v4/files/TokyoMetro/data/TokyoMetro-Train-GTFS.zip',
  access: {kind: 'key', provider: 'odpt', signupUrl: 'https://developer.odpt.org/', queryParam: 'acl:consumerKey'},
  license: 'https://developer.odpt.org/terms/data_basic_license.html',
};

describe('parseCuratedCatalog', () => {
  it('accepts references and full entries', () => {
    expect(parseCuratedCatalog([{mdbId: 'mdb-437'}, {mdbId: 'mdb-1', name: 'X'}, TOKYO])).toEqual([
      {mdbId: 'mdb-437', overrides: {}},
      {mdbId: 'mdb-1', overrides: {name: 'X'}},
      {
        entry: {
          ...TOKYO,
          originalUrl: null,
          bbox: null,
          featured: true,
          viaMobilityDatabase: false,
          access: {
            kind: 'key',
            provider: 'odpt',
            signupUrl: 'https://developer.odpt.org/',
            queryParam: 'acl:consumerKey',
            header: null,
          },
        },
      },
    ]);
  });

  it('rejects invalid entries naming the entry and field', () => {
    const ok = {mdbId: 'mdb-437'};
    expect(() => parseCuratedCatalog([ok, {...TOKYO, id: 'Bad Id'}])).toThrow(/entry 1.*id/);
    const {name: _name, ...noName} = TOKYO;
    expect(() => parseCuratedCatalog([ok, noName])).toThrow(/entry 1.*name/);
    expect(() => parseCuratedCatalog([ok, {...TOKYO, access: {kind: 'magic'}}])).toThrow(/entry 1.*access\.kind/);
    expect(() =>
      parseCuratedCatalog([ok, {...TOKYO, access: {...TOKYO.access, header: 'X-Key'}}]),
    ).toThrow(/entry 1.*queryParam/);
    const {queryParam: _q, ...noParam} = TOKYO.access;
    expect(() => parseCuratedCatalog([ok, {...TOKYO, access: noParam}])).toThrow(/entry 1.*queryParam/);
    expect(() => parseCuratedCatalog({})).toThrow(/array/);
  });
});

describe('parseCatalogSnapshot', () => {
  const entry = {
    id: 'a',
    name: 'A',
    place: 'Here',
    url: 'https://a.test/a.zip',
    originalUrl: null,
    access: {kind: 'direct'},
    license: null,
    bbox: [1, 2, 3, 4],
    featured: false,
    viaMobilityDatabase: true,
  };
  it('round-trips a snapshot', () => {
    const snapshot = {generatedAt: '2026-10-10T00:00:00Z', entries: [entry]};
    expect(parseCatalogSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });
  it('rejects an entry without url', () => {
    const {url: _url, ...noUrl} = entry;
    expect(() => parseCatalogSnapshot({generatedAt: 'x', entries: [entry, noUrl]})).toThrow(/entry 1.*url/);
  });

  it('rejects unsafe and duplicate ids', () => {
    const base = {
      name: 'N', place: 'P', url: 'https://x/a.zip', originalUrl: null, access: {kind: 'direct'},
      license: null, bbox: null, featured: false, viaMobilityDatabase: true,
    };
    expect(() => parseCatalogSnapshot({generatedAt: 'x', entries: [{...base, id: 'ok'}, {...base, id: 'a/b'}]})).toThrow(/entry 1.*id/);
    expect(() => parseCatalogSnapshot({generatedAt: 'x', entries: [{...base, id: 'Ok_1'}, {...base, id: 'Ok_1'}]})).toThrow(/entry 1.*duplicate id/);
  });
});
