import {describe, expect, it} from 'vitest';
import {loadSampleDb} from '../test-fixtures/sample-db.ts';
import {langParams, translated} from './translate.ts';

describe('translated', () => {
  it('uses the language column of the translations index in both subqueries', async () => {
    const {db} = await loadSampleDb();
    const expr = translated('stops', 'stop_name', 's', 'x');
    const plan = db
      .selectObjects(`EXPLAIN QUERY PLAN SELECT ${expr} FROM stops s`, {$lang: 'fr'})
      .map((row) => String(row['detail']))
      .join('\n');
    expect(plan.match(/language=\?/g)?.length).toBeGreaterThanOrEqual(2);
    // A TEMP B-TREE for ORDER BY rowid over the few exact matches is expected (first duplicate wins);
    // what must not happen is a wider search that omits the language, or a full scan of translations.
    expect(plan).not.toMatch(/SEARCH tr USING INDEX \S+ \(table_name=\? AND field_name=\?\)/);
    expect(plan).not.toMatch(/SCAN tr/);
  });

  it('is a bare column without a language', () => {
    expect(translated('stops', 'stop_name', 's', null)).toBe('s.stop_name');
    expect(langParams(null)).toEqual({});
  });
});
