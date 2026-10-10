import type {FeedLanguages} from '../shared/types.ts';

/** URL value that asks for a feed's original (untranslated) text. */
export const ORIGINAL_LANGUAGE = 'original';

export interface ResolvedLanguage {
  /** Language to show on the map: a translation or the original language. */
  readonly display: string | null;
  /** Language to query the worker with; `null` means original text. */
  readonly query: string | null;
}

function primarySubtag(code: string): string {
  const dash = code.indexOf('-');
  return dash === -1 ? code : code.slice(0, dash);
}

function sameCode(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Returns the feed's spelling of `code`, or null when the feed lacks it. */
function findExact(code: string, languages: readonly string[]): string | null {
  return languages.find((language) => sameCode(language, code)) ?? null;
}

/** Returns the feed's language sharing `code`'s primary subtag, or null. */
function findBySubtag(code: string, languages: readonly string[]): string | null {
  const primary = primarySubtag(code).toLowerCase();
  return languages.find((language) => primarySubtag(language).toLowerCase() === primary) ?? null;
}

function resolved(match: string, feed: FeedLanguages): ResolvedLanguage {
  const isOriginal = feed.originalLanguage !== null && sameCode(match, feed.originalLanguage);
  return {display: match, query: isOriginal ? null : match};
}

function original(feed: FeedLanguages): ResolvedLanguage {
  return {display: feed.originalLanguage, query: null};
}

/**
 * Picks the language to show for a feed. An explicit request wins, then the
 * browser's languages in order, then the feed's original language. Codes are
 * compared case-insensitively and the feed's own spelling is returned, since
 * the worker matches languages exactly.
 */
export function resolveLanguage(
  requested: string | null,
  browserLanguages: readonly string[],
  feed: FeedLanguages,
): ResolvedLanguage {
  if (requested !== null && sameCode(requested, ORIGINAL_LANGUAGE)) return original(feed);
  if (feed.languages.length === 0) return {display: null, query: null};

  if (requested !== null) {
    const exact = findExact(requested, feed.languages);
    if (exact !== null) return resolved(exact, feed);
  }
  for (const browser of browserLanguages) {
    const match = findExact(browser, feed.languages) ?? findBySubtag(browser, feed.languages);
    if (match !== null) return resolved(match, feed);
  }
  return original(feed);
}
