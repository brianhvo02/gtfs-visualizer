import {describe, expect, it} from 'vitest';
import {SAMPLE_FEED} from '../../../test-fixtures/sample-feed.ts';
import {feedCheck} from './feed.ts';
import {runCheck} from './test-helpers.ts';

const ROUTES_HEADER = 'route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n';

describe('feedCheck', () => {
  it('flags an expired feed', async () => {
    const issues = await runCheck(feedCheck, SAMPLE_FEED, new Date('2027-01-05T12:00:00Z'));
    expect(issues.map((i) => [i.ruleId, i.message])).toEqual([
      ['feed_expired', 'Service in this feed ended on 2026-12-31.'],
    ]);
  });

  it('flags a feed that has not started', async () => {
    const issues = await runCheck(feedCheck, SAMPLE_FEED, new Date('2025-06-01T12:00:00Z'));
    expect(issues.map((i) => [i.ruleId, i.message])).toEqual([
      ['feed_not_yet_active', 'Service in this feed starts on 2026-01-01.'],
    ]);
  });

  it('flags low-contrast route text', async () => {
    const routes =
      ROUTES_HEADER +
      'R10,DTA,10,Airport - Central,3,FF0000,\n' +
      'R20,DTA,20,Central - Furnace Creek,3,FFFF00,FFFFFF\n' +
      'R30,DTA,30,Harbor Ferry,4,green,\n';
    const issues = await runCheck(feedCheck, {...SAMPLE_FEED, 'routes.txt': routes});
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ruleId: 'route_color_contrast', routeId: 'R20'});
    expect(issues[0]?.message).toBe("Route 20's text has a contrast ratio of 1.1:1 against its color.");
  });

  it('ignores routes whose colors are absent or invalid', async () => {
    expect(await runCheck(feedCheck, SAMPLE_FEED)).toEqual([]);
  });
});
