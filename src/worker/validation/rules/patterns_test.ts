import {describe, expect, it} from 'vitest';
import {SAMPLE_FEED, VALID_FEED} from '../../../test-fixtures/sample-feed.ts';
import {patternsCheck} from './patterns.ts';
import {runCheck} from './test-helpers.ts';

function replaceIn(
  name: string,
  from: string,
  to: string,
  base: Readonly<Record<string, string>> = VALID_FEED,
): Record<string, string> {
  const text = base[name] ?? '';
  if (!text.includes(from)) throw new Error(`fixture lacks ${from}`);
  return {...base, [name]: text.replace(from, to)};
}

const MOVED_SHAPE = replaceIn('shapes.txt', 'SH10,36.914893,-116.76821,3', 'SH10,36.914893,-116.757,3');

describe('patternsCheck', () => {
  it('finds nothing in the valid feed', async () => {
    expect(await runCheck(patternsCheck, VALID_FEED)).toEqual([]);
  });

  it('flags buses faster than 150 km/h in the sample feed', async () => {
    const issues = await runCheck(patternsCheck, SAMPLE_FEED);
    const speed = issues.filter((i) => i.ruleId === 'unrealistic_speed');
    expect(speed).toHaveLength(2);
    expect(speed).toContainEqual(
      expect.objectContaining({routeId: 'R10', stopId: 'BEATTY', details: expect.objectContaining({toStopId: 'STN_A'})}),
    );
    expect(speed).toContainEqual(
      expect.objectContaining({routeId: 'R10', stopId: 'STN_A', details: expect.objectContaining({toStopId: 'NADAV'})}),
    );
    for (const i of speed) expect(Number(i.details?.['speedKmh'])).toBeGreaterThan(150);
  });

  it('merges equal times instead of reporting infinite speed', async () => {
    const files = replaceIn(
      'stop_times.txt',
      'T20_1,11:00:00,11:00:00,FUR,2',
      'T20_1,10:00:00,10:00:00,FUR,2\nT20_1,12:00:00,12:00:00,BEATTY,3',
    );
    expect(await runCheck(patternsCheck, files)).toEqual([]);
  });

  it('skips stops without coordinates', async () => {
    const files = replaceIn(
      'stops.txt',
      'NADAV,North Ave / D Ave N,36.914893,-116.76821,0,',
      'NADAV,North Ave / D Ave N,,,0,',
      SAMPLE_FEED,
    );
    const issues = await runCheck(patternsCheck, files);
    const hit = issues.find((i) => i.ruleId === 'unrealistic_speed' && i.stopId === 'BEATTY');
    expect(hit).toBeDefined();
    expect(Number(hit?.details?.['speedKmh'])).toBeGreaterThan(170);
    expect(Number(hit?.details?.['speedKmh'])).toBeLessThan(180);
    for (const i of issues) expect(i.message).not.toContain('NaN');
  });

  it('uses the ferry limit', async () => {
    const files = replaceIn('stop_times.txt', 'T30_1,16:00:00,16:00:00,STN_A,2', 'T30_1,14:30:00,14:30:00,STN_A,2');
    const issues = await runCheck(patternsCheck, files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ruleId: 'unrealistic_speed', routeId: 'R30'});
  });

  it('flags a stop far from its shape', async () => {
    const issues = await runCheck(patternsCheck, MOVED_SHAPE);
    const far = issues.filter((i) => i.ruleId === 'stop_far_from_shape');
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({routeId: 'R10', stopId: 'NADAV'});
    expect(Number(far[0]?.details?.['distanceM'])).toBeGreaterThan(500);
  });

  it('ignores trips without a real shape', async () => {
    const issues = await runCheck(patternsCheck, MOVED_SHAPE);
    expect(issues.filter((i) => i.routeId === 'R20')).toEqual([]);
  });
});
