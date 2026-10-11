import {describe, expect, it} from 'vitest';
import {VALID_FEED} from '../../../test-fixtures/sample-feed.ts';
import {stopsCheck} from './stops.ts';
import {runCheck, withValidFile} from './test-helpers.ts';

function withStops(extra: string): Record<string, string> {
  return withValidFile('stops.txt', `${VALID_FEED['stops.txt'] ?? ''}${extra}`);
}

describe('stopsCheck', () => {
  it('finds nothing in the valid feed', async () => {
    expect(await runCheck(stopsCheck, VALID_FEED)).toEqual([]);
  });

  it('flags a stop at 0,0', async () => {
    const issues = await runCheck(stopsCheck, withStops('Z,Zero Stop,0,0,0,\n'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'stop_invalid_coords',
      stopId: 'Z',
      message: 'Zero Stop has coordinates at 0,0.',
    });
  });

  it('flags coordinates out of range', async () => {
    const issues = await runCheck(stopsCheck, withStops('X,Far Stop,95,10,0,\n'));
    expect(issues.map((i) => i.message)).toEqual(['Far Stop has coordinates out of range.']);
  });

  it('flags a station with blank coordinates', async () => {
    const issues = await runCheck(stopsCheck, withStops('S,Blank Station,,,1,\n'));
    expect(issues.map((i) => [i.ruleId, i.message])).toEqual([
      ['stop_invalid_coords', 'Blank Station has missing coordinates.'],
    ]);
  });

  it('allows generic nodes and boarding areas without coordinates', async () => {
    expect(await runCheck(stopsCheck, withStops('N,Node,,,3,\nB,Boarding,,,4,\n'))).toEqual([]);
  });

  it('flags same-name stops about a meter apart, not ones 50 m away', async () => {
    const extra = 'D1,Main St,36.9,-116.7,0,\nD2,main st ,36.90001,-116.7,0,\nD3,Main St,36.9005,-116.7,0,\n';
    const issues = await runCheck(stopsCheck, withStops(extra));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ruleId: 'stops_near_duplicate', stopId: 'D1', details: {otherStopId: 'D2'}});
    expect(Number(issues[0]?.details?.['distanceM'])).toBeLessThan(2);
    expect(issues[0]?.message).toMatch(/^Main St and main st\s*have the same name and are 1\.\d m apart\.$/);
  });

  it('does not pair stops of different location types', async () => {
    const extra = 'D1,Main St,36.9,-116.7,0,\nD2,Main St,36.90001,-116.7,1,\n';
    expect(await runCheck(stopsCheck, withStops(extra))).toEqual([]);
  });

  it('finds duplicates across a cell boundary', async () => {
    const extra = 'D1,Edge,36.9,-116.7,0,\nD2,Edge,36.899999,-116.7,0,\n';
    const issues = await runCheck(stopsCheck, withStops(extra));
    expect(issues.map((i) => i.ruleId)).toEqual(['stops_near_duplicate']);
  });
});
