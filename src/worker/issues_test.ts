import {describe, expect, it} from 'vitest';
import {openMemoryDb} from '../test-fixtures/test-db.ts';
import {createGtfsTables} from './ddl.ts';
import {IssueCollector} from './issues.ts';

describe('IssueCollector', () => {
  it('caps stored rows per file and code, then writes a summary row', async () => {
    const db = await openMemoryDb();
    createGtfsTables(db);
    const issues = new IssueCollector(db, 3);
    for (let line = 2; line < 12; line++) {
      issues.add({
        severity: 'warning',
        file: 'stops.txt',
        line,
        column: null,
        code: 'ragged_row',
        message: 'ragged',
      });
    }
    issues.finish();
    expect(issues.totalCount()).toBe(10);
    expect(db.selectValue("SELECT count(*) FROM import_issues WHERE code = 'ragged_row'")).toBe(3);
    expect(db.selectValue("SELECT message FROM import_issues WHERE code = 'suppressed'")).toBe(
      '7 more "ragged_row" issues in stops.txt were not recorded.',
    );
  });
});
