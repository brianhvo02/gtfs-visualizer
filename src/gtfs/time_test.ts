import {describe, expect, it} from 'vitest';
import {
  addDays,
  formatClock,
  fromIsoDate,
  isValidGtfsDate,
  parseGtfsTime,
  todayInTimeZone,
  toIsoDate,
  weekdayOf,
} from './time.ts';

describe('parseGtfsTime', () => {
  it('parses zero-padded times', () => {
    expect(parseGtfsTime('08:00:00')).toBe(28800);
  });
  it('parses single-digit hours', () => {
    expect(parseGtfsTime('8:05:00')).toBe(29100);
  });
  it('parses times past midnight', () => {
    expect(parseGtfsTime('25:30:00')).toBe(91800);
  });
  it('trims whitespace', () => {
    expect(parseGtfsTime(' 07:00:00 ')).toBe(25200);
  });
  it('returns null for blank or invalid values', () => {
    expect(parseGtfsTime('')).toBeNull();
    expect(parseGtfsTime('8:60:00')).toBeNull();
    expect(parseGtfsTime('noon')).toBeNull();
  });
});

describe('formatClock', () => {
  it('formats with hours modulo 24', () => {
    expect(formatClock(28800)).toBe('08:00');
    expect(formatClock(87600)).toBe('00:20');
  });
});

describe('dates', () => {
  it('validates YYYYMMDD', () => {
    expect(isValidGtfsDate('20261012')).toBe(true);
    expect(isValidGtfsDate('20260230')).toBe(false);
    expect(isValidGtfsDate('2026-10-12')).toBe(false);
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('20261231', 1)).toBe('20270101');
    expect(addDays('20260301', -1)).toBe('20260228');
  });
  it('finds the weekday', () => {
    expect(weekdayOf('20261012')).toBe('monday');
    expect(weekdayOf('20261011')).toBe('sunday');
  });
  it('converts to and from ISO dates', () => {
    expect(toIsoDate('20261012')).toBe('2026-10-12');
    expect(fromIsoDate('2026-10-12')).toBe('20261012');
    expect(fromIsoDate('2026-02-30')).toBeNull();
    expect(fromIsoDate('garbage')).toBeNull();
  });
});

describe('todayInTimeZone', () => {
  const now = new Date('2026-10-10T05:00:00Z');
  it('uses the given time zone', () => {
    expect(todayInTimeZone('America/Los_Angeles', now)).toBe('20261009');
    expect(todayInTimeZone('Asia/Tokyo', now)).toBe('20261010');
  });
  it('falls back to the runtime zone for invalid zones', () => {
    expect(todayInTimeZone('Not/AZone', now)).toBe(todayInTimeZone(null, now));
  });
});
