import {describe, expect, it} from 'vitest';
import type {CatalogEntry} from './catalog-types.ts';
import {normalizeForSearch, searchCatalog} from './search.ts';

function entry(id: string, name: string, place: string): CatalogEntry {
  return {
    id,
    name,
    place,
    url: `https://example.test/${id}.zip`,
    originalUrl: null,
    access: {kind: 'direct'},
    license: null,
    bbox: null,
    featured: false,
    viaMobilityDatabase: false,
    official: true,
  };
}

const MBTA = entry('mbta', 'MBTA', 'Boston, MA, US');
const AKASHI = entry('akashi-bus', '明石市 — たこバス/たこバスミニ', 'Akashi, Hyogo Prefecture, JP');
const ZURICH = entry('zurich', 'Zürich VBZ', 'Zürich, CH');
const FERRY = entry('ferry', 'Akashi Ferry', 'Elsewhere, US');
const BUSES = Array.from({length: 60}, (_, i) => entry(`bus-${i}`, `Bus ${i}`, 'Nowhere, US'));
const FIXTURE = [MBTA, AKASHI, ZURICH, ...BUSES, FERRY];

describe('normalizeForSearch', () => {
  it('folds case, accents, width, and kana', () => {
    expect(normalizeForSearch('Zürich')).toBe('zurich');
    expect(normalizeForSearch('ＭＢＴＡ')).toBe('mbta');
    expect(normalizeForSearch('ミヨシ')).toBe('みよし');
    expect(normalizeForSearch('バス')).toBe('ばす');
    expect(normalizeForSearch('ﾊﾞｽ')).toBe('ばす');
  });
});

describe('searchCatalog', () => {
  it('finds entries across scripts', () => {
    expect(searchCatalog(FIXTURE, 'boston mbta').results).toEqual([MBTA]);
    expect(searchCatalog(FIXTURE, 'zurich').results).toEqual([ZURICH]);
    for (const q of ['明石', 'akashi', 'タコ', '明石　たこ']) {
      expect(searchCatalog(FIXTURE, q).results).toContain(AKASHI);
    }
  });

  it('ranks name matches above place-only matches', () => {
    const results = searchCatalog([AKASHI, FERRY], 'akashi').results;
    expect(results).toEqual([FERRY, AKASHI]);
  });

  it('limits results but reports the total', () => {
    const {results, total} = searchCatalog(FIXTURE, 'bus');
    expect(results).toHaveLength(50);
    expect(total).toBeGreaterThanOrEqual(61);
  });

  it('returns nothing for blank queries', () => {
    for (const q of ['', '   ', '　']) {
      expect(searchCatalog(FIXTURE, q)).toEqual({results: [], total: 0});
    }
  });
});
