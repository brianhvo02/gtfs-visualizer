import {formatClock} from '../gtfs/time.ts';
import type {ImportProgress} from '../shared/types.ts';

const SECONDS_PER_DAY = 86400;
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatServiceDate(date: string | null): string {
  const match = date === null ? null : /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  if (match === null) return '—';
  return DATE_FORMAT.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDeparture(secs: number): {readonly clock: string; readonly nextDay: boolean} {
  return {clock: formatClock(secs), nextDay: secs >= SECONDS_PER_DAY};
}

export function describeProgress(progress: ImportProgress): string {
  switch (progress.stage) {
    case 'parse': {
      const file = progress.file ?? 'feed';
      const done = progress.bytesDone ?? 0;
      const total = progress.bytesTotal ?? null;
      if (total !== null && total > 0) return `Reading ${file}… ${Math.floor((done / total) * 100)}%`;
      return `Reading ${file}… ${formatBytes(done)}`;
    }
    case 'index':
      return 'Building indexes…';
    case 'derive':
      return 'Preparing map data…';
    case 'register':
      return 'Saving…';
  }
}
