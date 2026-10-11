import {describe, expect, it} from 'vitest';
import {RULE_IDS} from '../../../shared/validation.ts';
import {loadSampleDb} from '../../../test-fixtures/sample-db.ts';
import {SAMPLE_FEED, VALID_FEED} from '../../../test-fixtures/sample-feed.ts';
import {runValidation} from '../runner.ts';
import {getValidationIssues} from '../store.ts';
import {ALL_CHECKS} from './index.ts';

const NOW = new Date('2026-10-10T12:00:00Z');

describe('ALL_CHECKS', () => {
  it('finds no issues in the valid feed', async () => {
    const {db} = await loadSampleDb(VALID_FEED);
    const status = await runValidation(db, {now: NOW, token: {cancelled: false}, checks: ALL_CHECKS});
    expect(status).toMatchObject({state: 'current', counts: {error: 0, warning: 0, info: 0}});
  });

  it('finds the known defects in the sample feed', async () => {
    const {db} = await loadSampleDb(SAMPLE_FEED);
    const status = await runValidation(db, {now: NOW, token: {cancelled: false}, checks: ALL_CHECKS});
    expect(status).toMatchObject({state: 'current', counts: {error: 0, warning: 3, info: 0}});
    const found = RULE_IDS.flatMap((ruleId) => getValidationIssues(db, {ruleId}).map(() => ruleId));
    expect(found.sort()).toEqual(['route_without_trips', 'unrealistic_speed', 'unrealistic_speed']);
  });

  it('every rule id is owned by exactly one check', () => {
    const owned = ALL_CHECKS.flatMap((check) => [...check.ruleIds]);
    expect(owned).toHaveLength(18);
    expect(new Set(owned)).toEqual(new Set(RULE_IDS));
  });
});
