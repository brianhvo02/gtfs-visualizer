import type {FeedLanguages} from '../shared/types.ts';
import {ORIGINAL_LANGUAGE} from '../state/resolve-language.ts';
import {languageName} from './format.ts';

export interface LanguageOption {
  readonly value: string;
  readonly label: string;
}

/** Options for the language select: original text first, then each translation; empty when there is nothing to choose. */
export function languageOptions(languages: FeedLanguages): LanguageOption[] {
  const original = languages.originalLanguage;
  const others = languages.languages.filter(
    (code) => original === null || code.toLowerCase() !== original.toLowerCase(),
  );
  if (others.length === 0) return [];
  return [
    {
      value: ORIGINAL_LANGUAGE,
      label: original === null ? 'Feed default' : `${languageName(original)} (original)`,
    },
    ...others.map((code) => ({value: code, label: languageName(code)})),
  ];
}
