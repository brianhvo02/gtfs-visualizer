import {describe, expect, it} from 'vitest';
import {languageOptions} from './language-options.ts';

describe('languageOptions', () => {
  it('lists the original first, then the other languages in feed order', () => {
    expect(languageOptions({languages: ['en', 'DE', 'fr'], originalLanguage: 'en'})).toEqual([
      {value: 'original', label: 'English (original)'},
      {value: 'DE', label: 'Deutsch'},
      {value: 'fr', label: 'français'},
    ]);
  });

  it('labels the original "Feed default" when the feed has no single original language', () => {
    expect(languageOptions({languages: ['DE', 'fr'], originalLanguage: null})).toEqual([
      {value: 'original', label: 'Feed default'},
      {value: 'DE', label: 'Deutsch'},
      {value: 'fr', label: 'français'},
    ]);
  });

  it('drops a translation that repeats the original in another case', () => {
    expect(languageOptions({languages: ['en', 'EN', 'fr'], originalLanguage: 'en'}).map((o) => o.value)).toEqual([
      'original',
      'fr',
    ]);
  });

  it('offers nothing when there is no language besides the original', () => {
    expect(languageOptions({languages: ['en'], originalLanguage: 'en'})).toEqual([]);
    expect(languageOptions({languages: [], originalLanguage: null})).toEqual([]);
  });
});
