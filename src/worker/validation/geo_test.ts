import {describe, expect, it} from 'vitest';
import {distanceToPolylineMeters, haversineMeters} from './geo.ts';

describe('haversineMeters', () => {
  it('measures one degree of latitude', () => {
    expect(haversineMeters([0, 0], [0, 1])).toBeCloseTo(111_195, 0);
  });
});

describe('distanceToPolylineMeters', () => {
  it('measures to the closest point on a segment', () => {
    expect(distanceToPolylineMeters([0.5, 0.001], [[0, 0], [1, 0]])).toBeCloseTo(111.2, 0);
  });

  it('measures to the endpoint beyond a segment', () => {
    expect(distanceToPolylineMeters([2, 0], [[0, 0], [1, 0]])).toBeCloseTo(111_195, -2);
  });

  it('measures to a one-point line', () => {
    expect(distanceToPolylineMeters([0, 1], [[0, 0]])).toBeCloseTo(111_195, 0);
  });
});
