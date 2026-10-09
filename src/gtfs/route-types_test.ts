import {describe, expect, it} from 'vitest';
import {contrastText, normalizeColor, routeCategory, routeLabel} from './route-types.ts';

describe('route types', () => {
  it('maps basic and extended route types to categories', () => {
    expect(routeCategory(3)).toBe('bus');
    expect(routeCategory(1)).toBe('subway');
    expect(routeCategory(4)).toBe('ferry');
    expect(routeCategory(109)).toBe('rail');
    expect(routeCategory(700)).toBe('bus');
    expect(routeCategory(900)).toBe('tram');
    expect(routeCategory(1200)).toBe('ferry');
    expect(routeCategory(99)).toBe('other');
  });
  it('normalizes GTFS colors and rejects invalid ones', () => {
    expect(normalizeColor('FF0000')).toBe('#ff0000');
    expect(normalizeColor('#00FF00')).toBe('#00ff00');
    expect(normalizeColor('green')).toBeNull();
    expect(normalizeColor('')).toBeNull();
    expect(normalizeColor(null)).toBeNull();
  });
  it('picks readable text colors', () => {
    expect(contrastText('#ffff00')).toBe('#000000');
    expect(contrastText('#000080')).toBe('#ffffff');
  });
  it('labels routes', () => {
    expect(routeLabel({routeId: 'R1', shortName: '10', longName: 'Main'})).toBe('10 · Main');
    expect(routeLabel({routeId: 'R1', shortName: null, longName: 'Main'})).toBe('Main');
    expect(routeLabel({routeId: 'R1', shortName: null, longName: null})).toBe('R1');
  });
});
