import {describe, expect, it} from 'vitest';
import {runStateFor, shouldAutoRetry} from './use-validation.ts';

const cancelled = {status: 'ok', value: {state: 'cancelled'}} as const;

describe('shouldAutoRetry', () => {
  it('retries a cancelled run while retries remain', () => {
    expect(shouldAutoRetry(cancelled, 'a', 0, 2)).toBe(true);
    expect(shouldAutoRetry(cancelled, 'a', 1, 2)).toBe(true);
  });

  it('stops when the budget is spent', () => {
    expect(shouldAutoRetry(cancelled, 'a', 2, 2)).toBe(false);
  });

  it('never retries without a feed, or for other states', () => {
    expect(shouldAutoRetry(cancelled, null, 0, 2)).toBe(false);
    expect(shouldAutoRetry({status: 'loading'}, 'a', 0, 2)).toBe(false);
    expect(shouldAutoRetry({status: 'error', error: new Error('x')}, 'a', 0, 2)).toBe(false);
    expect(shouldAutoRetry({status: 'ok', value: {state: 'failed', message: 'm'}}, 'a', 0, 2)).toBe(false);
  });
});

describe('runStateFor', () => {
  it('keeps the run state of the shown feed', () => {
    const stored = {feedId: 'a', attempt: 3, auto: 2};
    expect(runStateFor(stored, 'a')).toBe(stored);
  });

  it('starts a fresh retry budget whenever the shown feed changes', () => {
    const spent = {feedId: 'a', attempt: 2, auto: 2};
    const other = runStateFor(spent, 'b');
    expect(other).toEqual({feedId: 'b', attempt: 0, auto: 0});
    expect(runStateFor(other, 'a')).toEqual({feedId: 'a', attempt: 0, auto: 0});
  });
});
