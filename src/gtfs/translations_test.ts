import {describe, expect, it} from 'vitest';
import {checkTranslationRow, isLegacyTranslationsHeader} from './translations.ts';

const row =
  (values: Record<string, string>) =>
  (column: string): string =>
    values[column] ?? '';

describe('checkTranslationRow', () => {
  it('accepts a record_id or a field_value, and feed_info with neither', () => {
    expect(checkTranslationRow(row({table_name: 'stops', record_id: 'STN'}))).toBeNull();
    expect(checkTranslationRow(row({table_name: 'stops', field_value: 'Central'}))).toBeNull();
    expect(checkTranslationRow(row({table_name: 'feed_info'}))).toBeNull();
  });
  it('rejects neither or both keys', () => {
    expect(checkTranslationRow(row({table_name: 'stops'}))).toBe(
      'A translation needs either record_id or field_value.',
    );
    expect(checkTranslationRow(row({table_name: 'stops', record_id: 'FUR', field_value: 'Furnace Creek'}))).toBe(
      'A translation must not have both record_id and field_value.',
    );
  });
});

describe('isLegacyTranslationsHeader', () => {
  it('detects the legacy header', () => {
    expect(isLegacyTranslationsHeader(['trans_id', 'lang', 'translation'])).toBe(true);
    expect(
      isLegacyTranslationsHeader(['table_name', 'field_name', 'language', 'translation', 'trans_id', 'lang']),
    ).toBe(false);
  });
});
