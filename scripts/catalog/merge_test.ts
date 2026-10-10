import {describe, expect, it} from 'vitest';
import type {CatalogEntry} from '../../src/catalog/catalog-types.ts';
import {mergeCatalog} from './merge.ts';

function entry(id: string, name: string): CatalogEntry {
  return {
    id, name, place: 'P', url: `https://x/${id}.zip`, originalUrl: null, access: {kind: 'direct'},
    license: null, bbox: null, featured: false, viaMobilityDatabase: true,
  };
}

const mdb = [entry('mdb-3', 'Charlie'), entry('mdb-1', 'alpha'), entry('mdb-2', 'Bravo')];

describe('mergeCatalog', () => {
  it('puts featured first in curated order, rest sorted by name', () => {
    const out = mergeCatalog(mdb, [{mdbId: 'mdb-2', overrides: {}}, {mdbId: 'mdb-3', overrides: {}}]);
    expect(out.map((e) => e.id)).toEqual(['mdb-2', 'mdb-3', 'mdb-1']);
    expect(out.map((e) => e.featured)).toEqual([true, true, false]);
  });

  it('applies overrides', () => {
    const out = mergeCatalog(mdb, [{mdbId: 'mdb-1', overrides: {name: 'Better'}}]);
    expect(out[0]).toMatchObject({id: 'mdb-1', name: 'Better', featured: true});
  });

  it('inserts full entries', () => {
    const out = mergeCatalog(mdb, [{entry: {...entry('mine', 'Mine'), viaMobilityDatabase: false}}]);
    expect(out[0]?.id).toBe('mine');
    expect(out).toHaveLength(4);
  });

  it('throws on unknown mdbId and id collision', () => {
    expect(() => mergeCatalog(mdb, [{mdbId: 'nope', overrides: {}}])).toThrow('catalog.json entry 0: unknown mdbId "nope"');
    expect(() => mergeCatalog(mdb, [{mdbId: 'mdb-1', overrides: {}}, {entry: entry('mdb-2', 'X')}])).toThrow(
      'catalog.json entry 1: id "mdb-2" is already a Mobility Database feed',
    );
  });

  it('throws on duplicate resolved ids', () => {
    expect(() => mergeCatalog(mdb, [{mdbId: 'mdb-1', overrides: {}}, {mdbId: 'mdb-1', overrides: {}}])).toThrow(
      'catalog.json entry 1: duplicate id "mdb-1"',
    );
    expect(() => mergeCatalog(mdb, [{entry: entry('a', 'A')}, {entry: entry('a', 'B')}])).toThrow(
      'catalog.json entry 1: duplicate id "a"',
    );
  });
});
