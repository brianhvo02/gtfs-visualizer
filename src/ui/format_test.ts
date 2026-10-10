import {describe, expect, it} from 'vitest';
import {describeProgress, formatBytes, formatDeparture, formatServiceDate, languageName} from './format.ts';

describe('format', () => {
  it('names languages in their own language, falling back to the code', () => {
    expect(languageName('fr')).toBe('français');
    expect(languageName('not a code!')).toBe('not a code!');
  });
  it('formats service dates', () => {
    expect(formatServiceDate('20261012')).toBe('Oct 12, 2026');
    expect(formatServiceDate(null)).toBe('—');
  });
  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('marks departures after midnight', () => {
    expect(formatDeparture(30000)).toEqual({clock: '08:20', nextDay: false});
    expect(formatDeparture(87600)).toEqual({clock: '00:20', nextDay: true});
  });
  it('describes import progress', () => {
    expect(describeProgress({stage: 'parse', file: 'stops.txt', bytesDone: 50, bytesTotal: 200})).toBe(
      'Reading stops.txt… 25%',
    );
    expect(describeProgress({stage: 'parse', bytesDone: 2048, bytesTotal: null})).toBe('Reading feed… 2.0 KB');
    expect(describeProgress({stage: 'index'})).toBe('Building indexes…');
    expect(describeProgress({stage: 'derive'})).toBe('Preparing map data…');
    expect(describeProgress({stage: 'register'})).toBe('Saving…');
  });
});
