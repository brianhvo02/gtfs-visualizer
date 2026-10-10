import {describe, expect, it} from 'vitest';
import {SAMPLE_FEED, VALID_FEED} from '../../../test-fixtures/sample-feed.ts';
import {coverageCheck} from './coverage.ts';
import {runCheck, withValidFile} from './test-helpers.ts';

const CALENDAR_HEADER = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n';
const WEEKDAYS = 'WKDY,1,1,1,1,1,0,0,20260101,20991231\n';
const NEVER = 'WKND,0,0,0,0,0,0,0,20260101,20991231\n';

describe('coverageCheck', () => {
  it('finds nothing in the valid feed', async () => {
    expect(await runCheck(coverageCheck, VALID_FEED)).toEqual([]);
  });

  it('flags a route with no trips', async () => {
    const issues = await runCheck(coverageCheck, SAMPLE_FEED);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ruleId: 'route_without_trips', routeId: 'R30', message: 'Route 30 has no trips.'});
  });

  it('flags a stop no trip serves', async () => {
    const stops = `${VALID_FEED['stops.txt'] ?? ''}LONELY,Lonely Stop,36.9,-116.7,0,\n`;
    const issues = await runCheck(coverageCheck, {...VALID_FEED, 'stops.txt': stops});
    expect(issues.map((i) => [i.ruleId, i.stopId])).toEqual([['stop_unused', 'LONELY']]);
    expect(issues[0]?.message).toBe("Lonely Stop isn't served by any trip.");
  });

  it('flags a service whose calendar has no running days', async () => {
    // VALID_FEED inherits SAMPLE_FEED's calendar_dates (which add a WKND date); drop them.
    const files = {
      ...withValidFile('calendar.txt', `${CALENDAR_HEADER}${WEEKDAYS}${NEVER}`),
      'calendar_dates.txt': 'service_id,date,exception_type\n',
    };
    const issues = await runCheck(coverageCheck, files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'service_never_active',
      routeId: 'R20',
      details: {serviceId: 'WKND'},
      message: "Service WKND never runs, so route 20's trips that use it never run.",
    });
  });

  it('treats a service with only added dates as active', async () => {
    const files = {
      ...withValidFile('calendar.txt', `${CALENDAR_HEADER}${WEEKDAYS}${NEVER}`),
      'calendar_dates.txt': 'service_id,date,exception_type\nWKND,20261126,1\n',
    };
    expect(await runCheck(coverageCheck, files)).toEqual([]);
  });

  it('flags a service whose only running days are removed', async () => {
    const files = {
      ...withValidFile(
        'calendar.txt',
        `${CALENDAR_HEADER}${WEEKDAYS}WKND,0,0,0,0,0,1,0,20261107,20261107\n`,
      ),
      'calendar_dates.txt': 'service_id,date,exception_type\nWKND,20261107,2\n',
    };
    const issues = await runCheck(coverageCheck, files);
    expect(issues.map((i) => i.details)).toEqual([{serviceId: 'WKND'}]);
  });
});
