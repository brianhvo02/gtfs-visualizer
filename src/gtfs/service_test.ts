import {describe, expect, it} from 'vitest';
import {activeServiceIds, type CalendarDateRow, type CalendarRow} from './service.ts';

const WEEKDAY: CalendarRow = {
  service_id: 'WKDY',
  monday: 1,
  tuesday: 1,
  wednesday: 1,
  thursday: 1,
  friday: 1,
  saturday: 0,
  sunday: 0,
  start_date: '20260101',
  end_date: '20261231',
};
const WEEKEND: CalendarRow = {
  ...WEEKDAY,
  service_id: 'WKND',
  monday: 0,
  tuesday: 0,
  wednesday: 0,
  thursday: 0,
  friday: 0,
  saturday: 1,
  sunday: 1,
};
const HOLIDAY: readonly CalendarDateRow[] = [
  {service_id: 'WKDY', date: '20261126', exception_type: 2},
  {service_id: 'WKND', date: '20261126', exception_type: 1},
];

describe('activeServiceIds', () => {
  it('uses the weekday pattern inside the date range', () => {
    expect(activeServiceIds([WEEKDAY, WEEKEND], [], '20261012')).toEqual(new Set(['WKDY']));
    expect(activeServiceIds([WEEKDAY, WEEKEND], [], '20261011')).toEqual(new Set(['WKND']));
  });
  it('excludes dates outside the range', () => {
    expect(activeServiceIds([WEEKDAY], [], '20270104')).toEqual(new Set());
  });
  it('applies added and removed exceptions', () => {
    expect(activeServiceIds([WEEKDAY, WEEKEND], HOLIDAY, '20261126')).toEqual(new Set(['WKND']));
  });
  it('works for feeds with only calendar_dates', () => {
    const dates: CalendarDateRow[] = [{service_id: 'S1', date: '20261012', exception_type: 1}];
    expect(activeServiceIds([], dates, '20261012')).toEqual(new Set(['S1']));
    expect(activeServiceIds([], dates, '20261013')).toEqual(new Set());
  });
  it('ignores rows with missing dates', () => {
    const broken: CalendarRow = {...WEEKDAY, start_date: null};
    expect(activeServiceIds([broken], [], '20261012')).toEqual(new Set());
  });
});
