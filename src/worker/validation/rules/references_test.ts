import {describe, expect, it} from 'vitest';
import {VALID_FEED} from '../../../test-fixtures/sample-feed.ts';
import {referencesCheck} from './references.ts';
import {runCheck, withValidFile} from './test-helpers.ts';

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

function withTrip(row: string): Record<string, string> {
  const original = VALID_FEED['trips.txt'] ?? '';
  return withValidFile('trips.txt', `${original}${row}\n`);
}

describe('referencesCheck', () => {
  it('finds nothing in the valid feed', async () => {
    expect(await runCheck(referencesCheck, VALID_FEED)).toEqual([]);
  });

  it('flags a trip with an unknown route', async () => {
    const issues = await runCheck(referencesCheck, withTrip('NOPE,WKDY,TX,Nowhere,0,'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'trip_unknown_route',
      tripId: 'TX',
      routeId: null,
      message: "Trip TX refers to route NOPE, which isn't in routes.txt.",
    });
  });

  it('flags a trip with an unknown service', async () => {
    const issues = await runCheck(referencesCheck, withTrip('R10,GHOST,TX,Nowhere,0,'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'trip_unknown_service',
      routeId: 'R10',
      tripId: 'TX',
      message: "Trip TX uses service GHOST, which isn't in calendar.txt or calendar_dates.txt, so it never runs.",
    });
  });

  it('flags a shape with no points', async () => {
    const issues = await runCheck(referencesCheck, withTrip('R20,WKDY,TX,Nowhere,0,NOSHAPE'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'trip_unknown_shape',
      severity: 'warning',
      routeId: 'R20',
      tripId: 'TX',
      message: 'Trip TX uses shape NOSHAPE, which has no points in shapes.txt; its line is drawn from stop positions.',
    });
  });

  it('flags a platform whose parent is not a station', async () => {
    const stops = (VALID_FEED['stops.txt'] ?? '').replace('36.4253,-117.1331,0,STN', '36.4253,-117.1331,0,FUR');
    const issues = await runCheck(referencesCheck, withValidFile('stops.txt', stops));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ruleId: 'stop_unknown_parent', stopId: 'STN_A'});
    expect(issues[0]?.message).toMatch(/which isn't a station\.$/);
  });

  it('flags a missing parent and a boarding area under a station', async () => {
    const stops = lines(
      'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station',
      'STN,Central Station,36.425288,-117.133162,1,',
      'STN_A,Platform A,36.4253,-117.1331,0,GONE',
      'BA,Boarding,36.4254,-117.1332,4,STN',
    );
    const issues = await runCheck(referencesCheck, withValidFile('stops.txt', stops));
    const messages = issues.map((i) => i.message);
    expect(messages).toContain("Platform A has parent station GONE, which isn't in stops.txt.");
    expect(messages).toContain("Boarding has parent station STN, which isn't a platform.");
  });
});
