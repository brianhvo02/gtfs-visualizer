import {weekdayOf} from './time.ts';

export interface CalendarRow {
  readonly service_id: string;
  readonly monday: number | null;
  readonly tuesday: number | null;
  readonly wednesday: number | null;
  readonly thursday: number | null;
  readonly friday: number | null;
  readonly saturday: number | null;
  readonly sunday: number | null;
  readonly start_date: string | null;
  readonly end_date: string | null;
}

export interface CalendarDateRow {
  readonly service_id: string;
  readonly date: string | null;
  readonly exception_type: number | null;
}

/** Service ids running on `date` (YYYYMMDD) per calendar.txt plus calendar_dates.txt exceptions. */
export function activeServiceIds(
  calendar: readonly CalendarRow[],
  calendarDates: readonly CalendarDateRow[],
  date: string,
): Set<string> {
  const weekday = weekdayOf(date);
  const active = new Set<string>();
  for (const row of calendar) {
    if (row.start_date === null || row.end_date === null) continue;
    // YYYYMMDD strings compare correctly as text.
    if (date < row.start_date || date > row.end_date) continue;
    if (row[weekday] === 1) active.add(row.service_id);
  }
  for (const row of calendarDates) {
    if (row.date !== date) continue;
    if (row.exception_type === 1) active.add(row.service_id);
    if (row.exception_type === 2) active.delete(row.service_id);
  }
  return active;
}
