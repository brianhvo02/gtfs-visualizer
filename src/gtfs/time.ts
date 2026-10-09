export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

const WEEKDAYS_FROM_SUNDAY: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const TIME_PATTERN = /^\s*(\d{1,3}):(\d{2}):(\d{2})\s*$/;
const DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Seconds past midnight for a GTFS time ("25:30:00", "8:05:00"); null if blank or invalid. */
export function parseGtfsTime(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Formats seconds past midnight as HH:MM, wrapping hours past 24. */
export function formatClock(secs: number): string {
  const hours = Math.floor(secs / 3600) % 24;
  const minutes = Math.floor((secs % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function toUtcDate(date: string): Date | null {
  const match = DATE_PATTERN.exec(date);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    return null;
  }
  return result;
}

function fromUtcDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function isValidGtfsDate(value: string): boolean {
  return toUtcDate(value) !== null;
}

function requireDate(date: string): Date {
  const parsed = toUtcDate(date);
  if (parsed === null) throw new Error(`Invalid GTFS date: ${date}`);
  return parsed;
}

export function addDays(date: string, days: number): string {
  const parsed = requireDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return fromUtcDate(parsed);
}

export function weekdayOf(date: string): Weekday {
  const weekday = WEEKDAYS_FROM_SUNDAY[requireDate(date).getUTCDay()];
  if (weekday === undefined) throw new Error(`Invalid GTFS date: ${date}`);
  return weekday;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone});
    return true;
  } catch {
    return false;
  }
}

/** Today's date (YYYYMMDD) in the given zone, or in the runtime zone if null/invalid. */
export function todayInTimeZone(timeZone: string | null, now: Date): string {
  const zone = timeZone !== null && isValidTimeZone(timeZone) ? timeZone : undefined;
  // en-CA formats as YYYY-MM-DD.
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return iso.replaceAll('-', '');
}

export function toIsoDate(date: string): string {
  const match = DATE_PATTERN.exec(date);
  if (match === null) throw new Error(`Invalid GTFS date: ${date}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function fromIsoDate(value: string): string | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return null;
  const date = `${match[1]}${match[2]}${match[3]}`;
  return isValidGtfsDate(date) ? date : null;
}
