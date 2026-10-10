/**
 * The language code to give the map, in canonical BCP-47 form (`EN` → `en`, `zh-hant` → `zh-Hant`). Feeds often
 * use non-canonical casing, and Mapbox rejects its tile requests (HTTP 400) for those. Undefined restores the
 * map's default labels, which is also the answer for a malformed code.
 */
export function mapLanguage(lang: string | null): string | undefined {
  if (lang === null || lang.length === 0) return undefined;
  try {
    return Intl.getCanonicalLocales(lang)[0];
  } catch {
    return undefined;
  }
}
