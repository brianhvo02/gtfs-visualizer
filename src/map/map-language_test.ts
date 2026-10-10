import {describe, expect, it} from 'vitest';
import {mapLanguage} from './map-language.ts';

describe('mapLanguage', () => {
  it('canonicalizes feed language codes for the map', () => {
    expect(mapLanguage('EN')).toBe('en');
    expect(mapLanguage('en-us')).toBe('en-US');
    expect(mapLanguage('zh-hant')).toBe('zh-Hant');
    expect(mapLanguage('ja')).toBe('ja');
  });

  it('restores default labels for no language or a malformed code', () => {
    expect(mapLanguage(null)).toBeUndefined();
    expect(mapLanguage('not a code!')).toBeUndefined();
    expect(mapLanguage('')).toBeUndefined();
  });
});
