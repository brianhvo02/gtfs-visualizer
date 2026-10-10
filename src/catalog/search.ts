import type {CatalogEntry} from './catalog-types.ts';

const DEFAULT_LIMIT = 50;

/** Folds case, accents, width variants, and katakana/hiragana for matching. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function searchCatalog(
  entries: readonly CatalogEntry[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): {readonly results: readonly CatalogEntry[]; readonly total: number} {
  const tokens = normalizeForSearch(query).split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return {results: [], total: 0};

  const nameMatches: CatalogEntry[] = [];
  const otherMatches: CatalogEntry[] = [];
  for (const entry of entries) {
    const name = normalizeForSearch(entry.name);
    const fields = [name, normalizeForSearch(entry.place), normalizeForSearch(entry.id)];
    if (!tokens.every((t) => fields.some((f) => f.includes(t)))) continue;
    if (tokens.every((t) => name.includes(t))) nameMatches.push(entry);
    else otherMatches.push(entry);
  }
  const all = [...nameMatches, ...otherMatches];
  return {results: all.slice(0, limit), total: all.length};
}
