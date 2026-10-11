import {describe, expect, it} from 'vitest';
import {loadSqlite} from '../worker/sqlite.ts';
import {ClosingMemoryFeedStore} from './closing-feed-store.ts';

describe('ClosingMemoryFeedStore', () => {
  it('really closes a database but keeps its data for the next open', async () => {
    const store = new ClosingMemoryFeedStore(await loadSqlite());
    const first = store.open('a.db');
    first.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1), (2);');
    store.close('a.db');
    expect(() => first.exec('SELECT 1')).toThrow(/closed/);
    const second = store.open('a.db');
    expect(second.selectValues('SELECT x FROM t')).toEqual([1, 2]);
    expect(store.open('a.db')).toBe(second);
  });

  it('forgets removed databases', async () => {
    const store = new ClosingMemoryFeedStore(await loadSqlite());
    store.open('a.db').exec('CREATE TABLE t (x)');
    store.close('a.db');
    store.remove('a.db');
    expect(store.list()).toEqual([]);
    expect(store.open('a.db').selectValues("SELECT name FROM sqlite_master WHERE name = 't'")).toEqual([]);
  });
});
