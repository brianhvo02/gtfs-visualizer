import {describe, expect, it} from 'vitest';
import {applyPatch, EMPTY_SELECTION, parseSelection, serializeSelection} from './url-state.ts';

describe('url state', () => {
  it('parses and serializes selections', () => {
    const selection = parseSelection('?feed=demo&route=R10&stop=STN&date=2026-10-12');
    expect(selection).toEqual({feed: 'demo', route: 'R10', stop: 'STN', date: '20261012', lang: null});
    expect(serializeSelection(selection)).toBe('?feed=demo&route=R10&stop=STN&date=2026-10-12');
  });

  it('drops empty and invalid values', () => {
    expect(parseSelection('?feed=&date=2026-02-30')).toEqual(EMPTY_SELECTION);
    expect(serializeSelection(EMPTY_SELECTION)).toBe('');
  });

  it('round-trips ids that need escaping', () => {
    const selection = {...EMPTY_SELECTION, feed: 'a b', stop: 'x&y=z'};
    expect(parseSelection(serializeSelection(selection))).toEqual(selection);
  });

  it('clears route, stop, and date when switching feeds', () => {
    const current = {feed: 'a', route: 'R', stop: 'S', date: '20261012', lang: null};
    expect(applyPatch(current, {feed: 'b'})).toEqual({feed: 'b', route: null, stop: null, date: null, lang: null});
    expect(applyPatch(current, {feed: 'b', route: 'R2'})).toEqual({feed: 'b', route: 'R2', stop: null, date: null, lang: null});
    expect(applyPatch(current, {stop: null})).toEqual({...current, stop: null});
  });

  it('round-trips lang and keeps it when switching feeds', () => {
    expect(parseSelection('?feed=a&lang=fr').lang).toBe('fr');
    expect(serializeSelection({...EMPTY_SELECTION, feed: 'a', lang: 'fr'})).toBe('?feed=a&lang=fr');
    const current = {feed: 'a', route: 'R', stop: 'S', date: '20261012', lang: 'fr'};
    expect(applyPatch(current, {feed: 'b'})).toEqual({feed: 'b', route: null, stop: null, date: null, lang: 'fr'});
  });
});
