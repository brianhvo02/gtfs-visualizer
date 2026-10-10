import {describe, expect, it} from 'vitest';
import type {FeedLanguages} from '../shared/types.ts';
import {resolveLanguage} from './resolve-language.ts';

const feed: FeedLanguages = {languages: ['en', 'DE', 'fr'], originalLanguage: 'en'};

describe('resolveLanguage', () => {
  it.each([
    ['fr', ['en-US'], {display: 'fr', query: 'fr'}],
    ['de', [], {display: 'DE', query: 'DE'}], // feed's spelling
    ['es', ['fr-CA', 'en'], {display: 'fr', query: 'fr'}], // unavailable request → browser, base-language match
    [null, ['en-GB'], {display: 'en', query: null}],
    [null, ['ja'], {display: 'en', query: null}],
    ['en', ['fr'], {display: 'en', query: null}], // explicit original beats browser
    ['original', ['fr'], {display: 'en', query: null}],
  ])('resolves %s with browser %j', (requested, browser, expected) => {
    expect(resolveLanguage(requested, browser, feed)).toEqual(expected);
  });

  it('matches a regional feed language from a base browser language', () => {
    expect(resolveLanguage(null, ['fr'], {languages: ['fr-CA'], originalLanguage: null})).toEqual({display: 'fr-CA', query: 'fr-CA'});
  });

  it('shows original text for a multilingual feed when asked', () => {
    expect(resolveLanguage('original', ['fr'], {languages: ['fr'], originalLanguage: null})).toEqual({display: null, query: null});
  });

  it('resolves to nothing for a feed without languages', () => {
    expect(resolveLanguage('fr', ['fr'], {languages: [], originalLanguage: null})).toEqual({display: null, query: null});
  });
});
