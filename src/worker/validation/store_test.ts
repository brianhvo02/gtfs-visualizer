import {describe, expect, it} from 'vitest';
import {loadSampleDb} from '../../test-fixtures/sample-db.ts';
import {withFile} from '../../test-fixtures/sample-feed.ts';
import type {RuleBuffer} from './store.ts';
import {
  getCurrentStatus,
  getImportIssues,
  getValidationIssues,
  getValidationSummary,
  writeValidationResults,
} from './store.ts';

const AT = '2026-10-10T00:00:00Z';

function buffer(ruleId: RuleBuffer['ruleId'], issues: RuleBuffer['issues']): RuleBuffer {
  return {ruleId, total: issues.length, issues, errorMessage: null};
}

describe('validation store', () => {
  it('returns null and empty lists before any run', async () => {
    const {db} = await loadSampleDb();
    expect(getCurrentStatus(db)).toBeNull();
    expect(getValidationSummary(db)).toBeNull();
    expect(getValidationIssues(db, {routeId: 'R10'})).toEqual([]);
  });

  it('treats results from another ruleset version as outdated', async () => {
    const {db} = await loadSampleDb();
    writeValidationResults(db, [buffer('stop_unused', [{stopId: 'STN', message: 'x'}])], AT);
    expect(getCurrentStatus(db)).toEqual({state: 'current', counts: {error: 0, warning: 1, info: 0}, failedRules: 0});
    db.exec("UPDATE validation_meta SET value = '0' WHERE key = 'ruleset_version'");
    expect(getCurrentStatus(db)).toBeNull();
    expect(getValidationSummary(db)).toBeNull();
  });

  it('counts rules whose check could not run', async () => {
    const {db} = await loadSampleDb();
    const failed = (ruleId: RuleBuffer['ruleId']): RuleBuffer => ({ruleId, total: 0, issues: [], errorMessage: 'boom'});
    writeValidationResults(db, [failed('stop_unused'), failed('route_without_trips'), buffer('feed_expired', [])], AT);
    expect(getCurrentStatus(db)).toMatchObject({failedRules: 2});
  });

  it('filters by route, by stop, and by station including children', async () => {
    const {db} = await loadSampleDb();
    writeValidationResults(
      db,
      [
        buffer('stop_unused', [{stopId: 'STN_A', message: 'platform'}]),
        buffer('route_without_trips', [{routeId: 'R10', message: 'route'}]),
      ],
      AT,
    );
    expect(getValidationIssues(db, {routeId: 'R10'}).map((i) => i.message)).toEqual(['route']);
    expect(getValidationIssues(db, {stopId: 'STN_A'}).map((i) => i.message)).toEqual(['platform']);
    expect(getValidationIssues(db, {stopId: 'STN'}).map((i) => i.message)).toEqual(['platform']);
  });

  it('names linked entities and leaves missing ones null', async () => {
    const {db} = await loadSampleDb();
    writeValidationResults(
      db,
      [
        buffer('route_without_trips', [
          {routeId: 'NOPE', message: 'a'},
          {routeId: 'R10', message: 'b'},
        ]),
        buffer('stop_unused', [{stopId: 'STN_A', message: 'c', details: {n: 1}}]),
      ],
      AT,
    );
    const issues = getValidationIssues(db, {ruleId: 'route_without_trips'});
    expect(issues.map((i) => i.routeName)).toEqual([null, '10']);
    const stop = getValidationIssues(db, {ruleId: 'stop_unused'})[0];
    expect(stop?.stopName).toBe('Central Station Platform A');
    expect(stop?.details).toEqual({n: 1});
    expect(stop?.severity).toBe('warning');
  });

  it('groups import issues by code', async () => {
    const stops = [
      'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station',
      'BAD,Bad Stop,abc,-117.1,0,',
    ].join('\n');
    const {db} = await loadSampleDb(withFile('stops.txt', `${stops}\n`));
    writeValidationResults(db, [], AT);
    const groups = getValidationSummary(db)?.importIssues ?? [];
    expect(groups).toContainEqual(expect.objectContaining({code: 'invalid_value', count: 1}));
    expect(getImportIssues(db, 'invalid_value')).toHaveLength(1);
  });

  it('groups an import code with mixed severities into one group', async () => {
    const {db} = await loadSampleDb();
    db.exec(`INSERT INTO import_issues (severity, file, line, column_name, code, message) VALUES
      ('warning', 'stops.txt', 2, 'a', 'invalid_value', 'w'),
      ('error', 'stops.txt', 3, 'b', 'invalid_value', 'e'),
      ('warning', 'stops.txt', 4, 'c', 'invalid_value', 'w2')`);
    writeValidationResults(db, [], AT);
    const groups = (getValidationSummary(db)?.importIssues ?? []).filter((g) => g.code === 'invalid_value');
    expect(groups).toEqual([{code: 'invalid_value', severity: 'error', count: 3}]);
  });
});
