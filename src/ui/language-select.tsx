import type {ReactElement} from 'react';
import type {FeedLanguages} from '../shared/types.ts';
import {ORIGINAL_LANGUAGE} from '../state/resolve-language.ts';
import {languageOptions} from './language-options.ts';

export interface LanguageSelectProps {
  readonly languages: FeedLanguages;
  /** The resolved query language, or `ORIGINAL_LANGUAGE`. */
  readonly value: string | null;
  readonly onChange: (lang: string) => void;
}

export function LanguageSelect({languages, value, onChange}: LanguageSelectProps): ReactElement | null {
  const options = languageOptions(languages);
  if (options.length === 0) return null;
  return (
    <select
      className="language-select"
      aria-label="Language"
      value={value ?? ORIGINAL_LANGUAGE}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
