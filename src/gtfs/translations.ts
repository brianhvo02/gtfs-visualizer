/** True for the pre-standard Google translations.txt format (trans_id, lang, ...). */
export function isLegacyTranslationsHeader(header: readonly string[]): boolean {
  return header.includes('trans_id') && header.includes('lang') && !header.includes('table_name');
}

/** Returns an error message when a translations.txt row must be skipped, else null. */
export function checkTranslationRow(get: (column: string) => string): string | null {
  if (get('table_name') === 'feed_info') return null;
  const hasId = get('record_id') !== '';
  const hasValue = get('field_value') !== '';
  if (hasId && hasValue) return 'A translation must not have both record_id and field_value.';
  if (!hasId && !hasValue) return 'A translation needs either record_id or field_value.';
  return null;
}
