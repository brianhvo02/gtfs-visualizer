import {describe, expect, it} from 'vitest';
import {formatCounts, formatFailedRules, RULE_IDS, RULES} from './validation.ts';

describe('formatCounts', () => {
  it('omits zero counts and pluralizes', () => {
    expect(formatCounts({error: 1, warning: 12, info: 4})).toBe('1 error · 12 warnings · 4 info');
    expect(formatCounts({error: 0, warning: 1, info: 0})).toBe('1 warning');
    expect(formatCounts({error: 0, warning: 0, info: 0})).toBe('');
  });
});

describe('formatFailedRules', () => {
  it('says how many checks could not run', () => {
    expect(formatFailedRules(0)).toBe('');
    expect(formatFailedRules(1)).toBe("1 check couldn't run");
    expect(formatFailedRules(3)).toBe("3 checks couldn't run");
  });
});

describe('RULES', () => {
  it('covers every rule id once', () => {
    expect(new Set(RULE_IDS).size).toBe(18);
    expect(Object.keys(RULES).sort()).toEqual([...RULE_IDS].sort());
  });
});
