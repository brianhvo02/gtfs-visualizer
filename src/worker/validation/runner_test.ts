import {describe, expect, it} from 'vitest';
import {loadSampleDb} from '../../test-fixtures/sample-db.ts';
import type {ValidationProgress} from '../../shared/validation.ts';
import {runValidation, type CancelToken, type RunOptions, type ValidationCheck} from './runner.ts';
import {getValidationIssues, getValidationSummary} from './store.ts';

const NOW = new Date('2026-10-10T12:00:00Z');

function options(checks: readonly ValidationCheck[], token: CancelToken = {cancelled: false}): RunOptions {
  return {now: NOW, token, checks};
}

describe('runValidation', () => {
  it('stores at most 200 issues per rule but counts all', async () => {
    const {db} = await loadSampleDb();
    const check: ValidationCheck = {
      ruleIds: ['stop_unused'],
      async run(ctx) {
        for (let i = 0; i < 250; i++) ctx.emit('stop_unused', {stopId: 'STN', message: `m${i}`});
      },
    };
    const status = await runValidation(db, options([check]));
    expect(status).toEqual({state: 'current', counts: {error: 0, warning: 250, info: 0}, failedRules: 0});
    const rule = getValidationSummary(db)?.rules.find((r) => r.ruleId === 'stop_unused');
    expect(rule).toMatchObject({total: 250, stored: 200});
    expect(getValidationIssues(db, {ruleId: 'stop_unused'})).toHaveLength(200);
  });

  it('records a throwing check and keeps running the others', async () => {
    const {db} = await loadSampleDb();
    const a: ValidationCheck = {
      ruleIds: ['stop_unused', 'route_without_trips'],
      async run(ctx) {
        ctx.emit('stop_unused', {message: 'x'});
        throw new Error('boom');
      },
    };
    const b: ValidationCheck = {
      ruleIds: ['feed_expired'],
      async run(ctx) {
        ctx.emit('feed_expired', {message: 'expired'});
      },
    };
    const status = await runValidation(db, options([a, b]));
    expect(status).toEqual({state: 'current', counts: {error: 0, warning: 1, info: 0}, failedRules: 2});
    const rules = getValidationSummary(db)?.rules ?? [];
    expect(rules.find((r) => r.ruleId === 'stop_unused')).toMatchObject({errorMessage: 'boom', total: 0});
    expect(rules.find((r) => r.ruleId === 'route_without_trips')).toMatchObject({errorMessage: 'boom', total: 0});
  });

  it('rejects emits for rule ids the check does not own', async () => {
    const {db} = await loadSampleDb();
    const check: ValidationCheck = {
      ruleIds: ['stop_unused'],
      async run(ctx) {
        ctx.emit('feed_expired', {message: 'nope'});
      },
    };
    await runValidation(db, options([check]));
    const rules = getValidationSummary(db)?.rules ?? [];
    expect(rules.find((r) => r.ruleId === 'stop_unused')?.errorMessage).not.toBeNull();
    expect(rules.find((r) => r.ruleId === 'feed_expired')).toBeUndefined();
  });

  it('leaves previous results when cancelled', async () => {
    const {db} = await loadSampleDb();
    const first: ValidationCheck = {
      ruleIds: ['stop_unused'],
      async run(ctx) {
        ctx.emit('stop_unused', {stopId: 'STN', message: 'old'});
      },
    };
    await runValidation(db, options([first]));
    const token: CancelToken = {cancelled: false};
    const second: ValidationCheck = {
      ruleIds: ['stop_unused'],
      async run(ctx) {
        token.cancelled = true;
        await ctx.checkpoint();
      },
    };
    expect(await runValidation(db, options([second], token))).toEqual({state: 'cancelled'});
    expect(getValidationIssues(db, {ruleId: 'stop_unused'}).map((i) => i.message)).toEqual(['old']);
  });

  it('keeps previous results when writing new ones fails', async () => {
    const {db} = await loadSampleDb();
    const emitting = (message: string): ValidationCheck => ({
      ruleIds: ['stop_unused'],
      async run(ctx) {
        ctx.emit('stop_unused', {stopId: 'STN', message});
      },
    });
    await runValidation(db, options([emitting('old')]));
    db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON validation_issues BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const status = await runValidation(db, options([emitting('new')]));
    expect(status).toEqual({state: 'failed', message: expect.stringContaining('disk full')});
    expect(getValidationIssues(db, {ruleId: 'stop_unused'}).map((i) => i.message)).toEqual(['old']);
  });

  it('reports progress per check', async () => {
    const {db} = await loadSampleDb();
    const noop: ValidationCheck = {ruleIds: [], async run() {}};
    const calls: ValidationProgress[] = [];
    await runValidation(db, {...options([noop, noop]), onProgress: (p) => calls.push(p)});
    expect(calls).toEqual([
      {checkIndex: 0, checkCount: 2},
      {checkIndex: 1, checkCount: 2},
    ]);
  });

  it('passes today in the feed time zone', async () => {
    const {db} = await loadSampleDb();
    let seen = '';
    const check: ValidationCheck = {
      ruleIds: [],
      async run(ctx) {
        seen = ctx.today;
      },
    };
    await runValidation(db, {...options([check]), now: new Date('2026-10-10T05:00:00Z')});
    expect(seen).toBe('20261009');
  });
});
