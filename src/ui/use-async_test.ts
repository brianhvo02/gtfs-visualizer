import {describe, expect, it} from 'vitest';
import {sameDeps} from './use-async.ts';

describe('sameDeps', () => {
  it('accepts equal lists', () => {
    expect(sameDeps(['a', 1], ['a', 1])).toBe(true);
    expect(sameDeps([], [])).toBe(true);
  });
  it('rejects different lengths', () => {
    expect(sameDeps(['a'], ['a', 'b'])).toBe(false);
  });
  it('rejects a different element', () => {
    expect(sameDeps(['a', null], ['a', 'x'])).toBe(false);
  });
  it('treats NaN as equal to NaN', () => {
    expect(sameDeps([NaN], [NaN])).toBe(true);
  });
  it('compares objects by reference', () => {
    const obj = {};
    expect(sameDeps([obj], [obj])).toBe(true);
    expect(sameDeps([{}], [{}])).toBe(false);
  });
});
