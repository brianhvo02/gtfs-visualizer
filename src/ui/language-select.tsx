import type {ReactElement} from 'react';
import type {FeedLanguages} from '../shared/types.ts';
import {ORIGINAL_LANGUAGE} from '../state/resolve-language.ts';
import {languageName} from './format.ts';

export interface LanguageSelectProps {
  readonly languages: FeedLanguages;
  /** The resolved query language, or `ORIGINAL_LANGUAGE`. */
  readonly value: string | null;
  readonly onChange: (lang: string) => void;
}

export function LanguageSelect({languages, value, onChange}: LanguageSelectProps): ReactElement | null {
  const original = languages.originalLanguage;
  const others = languages.languages.filter(
    (code) => original === null || code.toLowerCase() !== original.toLowerCase(),
  );
  if (others.length === 0) return null;
  return (
    <select
      className="language-select"
      aria-label="Language"
      value={value ?? ORIGINAL_LANGUAGE}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={ORIGINAL_LANGUAGE}>
        {original === null ? 'Feed default' : `${languageName(original)} (original)`}
      </option>
      {others.map((code) => (
        <option key={code} value={code}>
          {languageName(code)}
        </option>
      ))}
    </select>
  );
}
