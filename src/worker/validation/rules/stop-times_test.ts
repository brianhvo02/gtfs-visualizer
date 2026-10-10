import {describe, expect, it} from 'vitest';
import {loadSampleDb} from '../../../test-fixtures/sample-db.ts';
import {VALID_FEED} from '../../../test-fixtures/sample-feed.ts';
import {runValidation} from '../runner.ts';
import {getValidationSummary} from '../store.ts';
import {stopTimesCheck, TRIP_BATCH} from './stop-times.ts';
import {runCheck, withValidFile} from './test-helpers.ts';

function withStopTimes(replace: (text: string) => string, append = ''): Record<string, string> {
  return withValidFile('stop_times.txt', `${replace(VALID_FEED['stop_times.txt'] ?? '')}${append}`);
}

describe('stopTimesCheck', () => {
  it('finds nothing in the valid feed', async () => {
    expect(await runCheck(stopTimesCheck, VALID_FEED)).toEqual([]);
  });

  it('flags a time earlier than the previous stop', async () => {
    const files = withStopTimes((t) => t.replace('T20_1,11:00:00,11:00:00,FUR,2', 'T20_1,09:00:00,09:00:00,FUR,2'));
    const issues = await runCheck(stopTimesCheck, files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'stop_times_out_of_order',
      tripId: 'T20_1',
      routeId: 'R20',
      stopId: 'FUR',
      details: {stopSequence: 2},
    });
  });

  it('ignores untimed stops when ordering', async () => {
    const issues = await runCheck(stopTimesCheck, VALID_FEED);
    expect(issues.filter((i) => i.tripId === 'T10_1')).toEqual([]);
  });

  it('flags departure before arrival', async () => {
    const files = withStopTimes((t) => t.replace('T20_1,10:00:00,10:00:00,STN_A,1', 'T20_1,10:00:00,09:59:00,STN_A,1'));
    const issues = await runCheck(stopTimesCheck, files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ruleId: 'stop_times_out_of_order', stopId: 'STN_A'});
  });

  it('flags trips with one or zero stop times', async () => {
    const trips = `${VALID_FEED['trips.txt'] ?? ''}R10,WKDY,TX,X,0,\nR10,WKDY,TY,Y,0,\n`;
    const files = {...withStopTimes((t) => t, 'TX,08:00:00,08:00:00,BEATTY,1\n'), 'trips.txt': trips};
    const issues = await runCheck(stopTimesCheck, files);
    const messages = issues.map((i) => i.message).sort();
    expect(messages).toEqual([
      'Trip TX has 1 stop time; a trip needs at least 2.',
      'Trip TY has 0 stop times; a trip needs at least 2.',
    ]);
    expect(issues[0]).toMatchObject({ruleId: 'trip_too_few_stops', routeId: 'R10'});
  });

  it('flags stop times for unknown trips and stops', async () => {
    const files = withStopTimes(
      (t) => t,
      'GHOST,08:00:00,08:00:00,BEATTY,1\nGHOST,09:00:00,09:00:00,BEATTY,2\nT20_1,12:00:00,12:00:00,NOWHERE,3\n',
    );
    const issues = await runCheck(stopTimesCheck, files);
    expect(issues).toHaveLength(2);
    const unknownTrip = issues.find((i) => i.ruleId === 'stop_time_unknown_trip');
    expect(unknownTrip).toMatchObject({
      tripId: null,
      routeId: null,
      stopId: null,
      details: {tripId: 'GHOST'},
      message: "stop_times.txt lists trip GHOST, which isn't in trips.txt.",
    });
    const unknownStop = issues.find((i) => i.ruleId === 'stop_time_unknown_stop');
    expect(unknownStop).toMatchObject({
      tripId: 'T20_1',
      routeId: 'R20',
      message: "Trip T20_1 stops at NOWHERE, which isn't in stops.txt.",
    });
  });

  it('scans across batch boundaries', async () => {
    const count = TRIP_BATCH + 1;
    const tripRows: string[] = [];
    const timeRows: string[] = [];
    for (let i = 0; i < count; i++) {
      tripRows.push(`R10,WKDY,B${String(i).padStart(5, '0')},X,0,`);
      timeRows.push(`B${String(i).padStart(5, '0')},08:00:00,08:00:00,BEATTY,1`);
    }
    const files = {
      ...withStopTimes((t) => t, `${timeRows.join('\n')}\n`),
      'trips.txt': `${VALID_FEED['trips.txt'] ?? ''}${tripRows.join('\n')}\n`,
    };
    const {db} = await loadSampleDb(files);
    await runValidation(db, {now: new Date('2026-10-10T12:00:00Z'), token: {cancelled: false}, checks: [stopTimesCheck]});
    const rule = getValidationSummary(db)?.rules.find((r) => r.ruleId === 'trip_too_few_stops');
    expect(rule?.total).toBe(count);
  });
});
