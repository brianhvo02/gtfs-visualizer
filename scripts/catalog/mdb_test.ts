import {describe, expect, it} from 'vitest';
import {MDB_REQUIRED_COLUMNS, mapMobilityDatabaseRows, rowsFromCsv} from './mdb.ts';

function row(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const column of MDB_REQUIRED_COLUMNS) base[column] = '';
  return {
    ...base,
    id: 'mdb-1',
    data_type: 'gtfs',
    status: 'active',
    provider: 'Prov',
    'urls.direct_download': 'https://example.com/feed.zip',
    ...overrides,
  };
}

function one(overrides: Record<string, string>) {
  const [entry] = mapMobilityDatabaseRows([row(overrides)]).entries;
  if (!entry) throw new Error('row was dropped');
  return entry;
}

describe('mapMobilityDatabaseRows', () => {
  it('drops inactive, deprecated, and non-gtfs rows; keeps empty status', () => {
    const {entries} = mapMobilityDatabaseRows([
      row({id: 'a', status: 'inactive'}),
      row({id: 'b', status: 'deprecated'}),
      row({id: 'c', data_type: 'gtfs_rt'}),
      row({id: 'd', status: ''}),
    ]);
    expect(entries.map((e) => e.id)).toEqual(['d']);
  });

  it('skips unsafe and duplicate ids, keeping the first', () => {
    const {entries, skipped} = mapMobilityDatabaseRows([
      row({id: 'ok', name: 'first'}),
      row({id: 'a/b'}),
      row({id: 'a b'}),
      row({id: 'ok', name: 'second'}),
    ]);
    expect(entries.map((e) => e.name)).toEqual(['Prov — first']);
    expect(skipped).toEqual({invalidId: 2, duplicateId: 1});
  });

  it('maps no-auth feeds with a latest copy to direct', () => {
    const e = one({'urls.authentication_type': '0', 'urls.latest': 'https://files.example/latest.zip'});
    expect(e.access).toEqual({kind: 'direct'});
    expect(e.url).toBe('https://files.example/latest.zip');
    expect(e.originalUrl).toBe('https://example.com/feed.zip');
    expect(e.viaMobilityDatabase).toBe(true);
    expect(e.featured).toBe(false);
  });

  it('maps key auth by query param and header', () => {
    const q = one({
      'urls.authentication_type': '1',
      'urls.authentication_info': 'https://signup.example/',
      'urls.api_key_parameter_name': 'key',
      'urls.latest': 'https://files.example/latest.zip',
    });
    expect(q.access).toEqual({kind: 'key', provider: 'example.com', signupUrl: 'https://signup.example/', queryParam: 'key', header: null});
    expect(q.url).toBe('https://example.com/feed.zip');
    expect(q.viaMobilityDatabase).toBe(false);
    const h = one({
      'urls.authentication_type': '2',
      'urls.authentication_info': 'https://signup.example/',
      'urls.api_key_parameter_name': 'X-Key',
    });
    expect(h.access).toEqual({kind: 'key', provider: 'example.com', signupUrl: 'https://signup.example/', queryParam: null, header: 'X-Key'});
  });

  it('falls back to download', () => {
    expect(one({'urls.authentication_type': '1', 'urls.authentication_info': 'https://s/'}).access).toEqual({kind: 'download', pageUrl: null});
    const e = one({'urls.authentication_type': '0'});
    expect(e.access).toEqual({kind: 'download', pageUrl: null});
    expect(e.url).toBe('https://example.com/feed.zip');
  });

  it('builds names', () => {
    expect(one({name: ''}).name).toBe('Prov');
    expect(one({provider: '明石市', name: 'たこバス'}).name).toBe('明石市 — たこバス');
    expect(one({provider: 'Same', name: 'Same'}).name).toBe('Same');
  });

  it('builds place', () => {
    expect(one({
      'location.municipality': 'Akashi',
      'location.subdivision_name': 'Hyogo Prefecture',
      'location.country_code': 'JP',
    }).place).toBe('Akashi, Hyogo Prefecture, JP');
    expect(one({'location.country_code': 'JP'}).place).toBe('JP');
  });

  it('builds bbox', () => {
    expect(one({
      'location.bounding_box.minimum_latitude': '1',
      'location.bounding_box.maximum_latitude': '2',
      'location.bounding_box.minimum_longitude': '3',
      'location.bounding_box.maximum_longitude': '4',
    }).bbox).toEqual([3, 1, 4, 2]);
    expect(one({'location.bounding_box.minimum_latitude': '1'}).bbox).toBeNull();
  });
});

describe('rowsFromCsv', () => {
  it('throws when a required column is missing', () => {
    const header = MDB_REQUIRED_COLUMNS.filter((c) => c !== 'urls.latest').join(',');
    expect(() => rowsFromCsv(`${header}\n`)).toThrow(/missing column urls.latest/);
  });

  it('returns records keyed by header', () => {
    const header = MDB_REQUIRED_COLUMNS.join(',');
    const values = MDB_REQUIRED_COLUMNS.map((c) => (c === 'id' ? 'x' : '')).join(',');
    expect(rowsFromCsv(`${header}\n${values}\n`)[0]?.['id']).toBe('x');
  });
});
