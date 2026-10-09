# Feed Import, Data Layer & Static Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static-hosted web app that imports GTFS zips (curated catalog, URL, or upload) into per-feed SQLite databases in OPFS and lets people explore routes, stops, and departures on a Mapbox map.

**Architecture:** A dedicated Web Worker owns `@sqlite.org/sqlite-wasm` with the `opfs-sahpool` VFS and exposes a `FeedService` to the React UI over Comlink. Import streams the zip through `fflate` and a hand-written streaming CSV parser into batched inserts, then builds derived tables (`route_shapes`, `route_patterns`, `stop_routes`, `feed_summary`). The UI is URL-driven (`?feed=&route=&stop=&date=`) and talks to the map only through a provider-neutral `MapAdapter` (Mapbox in production, a DOM-rendering fake in E2E tests). A nightly GitHub Action mirrors the author's catalog feeds into Cloudflare R2.

**Tech Stack:** React 19, TypeScript 6, Vite 8, `@sqlite.org/sqlite-wasm` 3.53.4-build2, `fflate` 0.8.3, `comlink` 4.4.2, `mapbox-gl` 3.32.0, Vitest 5, Playwright 1.64, `@aws-sdk/client-s3` (mirror script only).

**Spec:** `docs/superpowers/specs/2026-10-09-feed-import-and-explorer-design.md`

**One deliberate deviation from the spec's wording:** the spec says import writes `<id>.tmp.db` and renames it. The `opfs-sahpool` VFS has no rename operation, so each import writes a fresh versioned file `/feeds/<id>-<epochMillis>.db`; the `meta.db` row is switched to the new filename in one statement, and only then is the old file unlinked. Orphaned files (from a crash mid-import) are unlinked at startup. The guarantee is the same: an existing feed is untouched until the new one is complete.

## Global Constraints

- Node ≥ 24 (scripts run TypeScript directly via Node type stripping).
- Exact dependency versions: `@sqlite.org/sqlite-wasm@3.53.4-build2`, `fflate@0.8.3`, `comlink@4.4.2`, `mapbox-gl@3.32.0`, `vitest@5.0.3`, `@playwright/test@1.64.0`, `@types/geojson@7946.0.16`, `@aws-sdk/client-s3@3.1148.0`.
- Code style follows the project `typescript` skill (Google TS style): semicolons, single quotes, named exports only (tool config files that require a default export are the exception), no `any`, no non-null `!`, explicit return types on exported functions, interfaces for object shapes, lower-kebab-case file names, test files named `*_test.ts`.
- `erasableSyntaxOnly` is on: no `enum`, no constructor parameter properties, no `namespace`.
- Every relative import includes its `.ts`/`.tsx` extension (so Node can run shared code in scripts).
- Only `src/map/mapbox-adapter.ts` imports `mapbox-gl`.
- UI code (`src/ui`, `src/map`, `src/state`, `src/catalog`, `src/db-client`) imports from `src/worker` with `import type` only — except `src/db-client/host.ts`, which references the worker entry URL.
- No COOP/COEP headers anywhere; storage uses `opfs-sahpool` only.
- One database per feed at `/feeds/<id>-<epochMillis>.db`; registry at `/meta.db`.
- Inserts are batched ~10,000 rows per transaction; indexes are created after bulk load.
- GTFS times are stored both as original text and as integer seconds past midnight (`*_secs`).
- "Today" is computed in the feed's `agency_timezone`.
- Env vars: `VITE_MAPBOX_TOKEN`, `VITE_CATALOG_BASE_URL`, `VITE_MAP_PROVIDER` (`mapbox` default, `fake` for E2E).

## Review Focus

1. **Zips with files inside a folder or with macOS junk** (`gtfs/stops.txt`, `__MACOSX/._stops.txt`) — import should find files by base name and ignore junk entries. Test: Task 5.
2. **Blank stop times and single-digit hours** (`""` for non-timepoints, `9:00:00`) — stored as NULL / parsed correctly, blank rows excluded from departures without errors. Tests: Task 1 and Task 7.
3. **Selecting a parent station** — users click a station, not a platform; its routes and departures should come from its child platforms. Test: Task 7.
4. **Deep links to things that don't exist** (deleted feed, unknown route/stop id) — show a clear notice instead of a blank or crashed view. Tests: Task 8 (`openFeed` → null), Task 7 (detail → null), Task 14 (E2E).
5. **Invalid `route_color` values** (`#00FF00`, `green`, empty) — normalized or replaced with a per-mode fallback so the map never receives an invalid color. Test: Task 7.

---

## File Structure

```
src/
  main.tsx                        (modify) render <App/>
  index.css                       (replace) app styles
  vite-env.d.ts                   env typing
  app.tsx                         App + Explorer layout, URL wiring
  gtfs/
    time.ts                       GTFS time/date helpers
    service.ts                    activeServiceIds
    csv.ts                        streaming CSV parser
    schema.ts                     GTFS table/column definitions
    route-types.ts                route_type → category, colors
  shared/
    types.ts                      types crossing the worker boundary
  worker/
    sqlite.ts                     sqlite-wasm loader + Database type re-export
    ddl.ts                        CREATE TABLE / INDEX from schema
    issues.ts                     IssueCollector
    table-writer.ts               row conversion + batched inserts
    loader.ts                     zip → CSV → tables
    derive.ts                     derived tables
    sql-values.ts                 SqlValue narrowing helpers
    queries.ts                    read queries
    feed-store.ts                 FeedStore interface + MemoryFeedStore
    sahpool-store.ts              OPFS FeedStore (browser only)
    feed-service.ts               import orchestration, registry, query facade
    worker.ts                     worker entry (Comlink)
  test-fixtures/
    sample-feed.ts                sample GTFS text + zip helpers
    test-db.ts                    in-memory DB helper for tests
  db-client/
    worker-host.ts                lock + worker lifecycle + crash restart
    host.ts                       app singleton host
    support.ts                    browser capability check
  catalog/
    catalog-types.ts              shared catalog JSON types
    catalog.ts                    fetch + merge catalog, update detection
  state/
    url-state.ts                  URL <-> Selection
  map/
    adapter.ts                    MapAdapter interface, layer/filter types
    layers.ts                     base layers, selection styling, bounds
    create-map.ts                 provider selection
    mapbox-adapter.ts             Mapbox implementation
    fake-adapter.ts               DOM implementation for E2E
    map-view.tsx                  React map component
  ui/
    use-async.ts                  async state hook
    format.ts                     labels, dates, bytes
    route-filter.ts               route search/filter
    host-notice.tsx               other-tab / unsupported / crashed screens
    feed-picker.tsx               saved + catalog feeds, import
    use-import.ts                 import flow hook
    route-list.tsx
    route-detail.tsx
    stop-detail.tsx
    feed-info.tsx
e2e/
  helpers.ts
  explorer.spec.ts
scripts/
  mirror/mirror.ts, mirror_test.ts, run.ts
  perf-import.ts
catalog/catalog.json
.github/workflows/mirror-catalog.yml
docs/deploy.md, docs/perf-baseline.md
vitest.config.ts, playwright.config.ts, .env.example, .env.e2e
```

---

### Task 1: Tooling and GTFS time/date helpers

**Files:**
- Modify: `package.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `.gitignore`
- Create: `vitest.config.ts`, `.env.example`, `src/vite-env.d.ts`, `src/gtfs/time.ts`
- Test: `src/gtfs/time_test.ts`

**Interfaces:**
- Produces:
  - `type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'`
  - `parseGtfsTime(value: string): number | null`
  - `formatClock(secs: number): string` — `HH:MM`, hours modulo 24
  - `isValidGtfsDate(value: string): boolean`
  - `addDays(date: string, days: number): string` (YYYYMMDD in/out)
  - `weekdayOf(date: string): Weekday`
  - `todayInTimeZone(timeZone: string | null, now: Date): string` (YYYYMMDD; invalid/null zone → runtime default zone)
  - `toIsoDate(date: string): string` (YYYYMMDD → YYYY-MM-DD)
  - `fromIsoDate(value: string): string | null` (YYYY-MM-DD → YYYYMMDD)

- [ ] **Step 1: Commit the existing Vite scaffold as a baseline**

```bash
git add .gitignore .oxlintrc.json README.md index.html package.json package-lock.json public src tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts skills-lock.json .agents
git commit -m "chore: add Vite React TypeScript scaffold"
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @sqlite.org/sqlite-wasm@3.53.4-build2 fflate@0.8.3 comlink@4.4.2 mapbox-gl@3.32.0
npm install -D vitest@5.0.3 @playwright/test@1.64.0 @types/geojson@7946.0.16 @aws-sdk/client-s3@3.1148.0
npx playwright install chromium
```

- [ ] **Step 3: Configure TypeScript, Vite, Vitest, scripts, env**

`tsconfig.app.json` — add strict mode to `compilerOptions`:

```json
    "strict": true,
```

(Insert it directly under `"skipLibCheck": true,`.)

`tsconfig.node.json` — replace the `lib` and `include` lines:

```json
    "lib": ["ES2023", "DOM"],
```

```json
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts", "e2e", "scripts"]
```

and add `"strict": true,` under `"skipLibCheck": true,`.

`vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // sqlite-wasm locates its .wasm file relative to its own module URL;
  // pre-bundling breaks that.
  optimizeDeps: {exclude: ['@sqlite.org/sqlite-wasm']},
  worker: {format: 'es'},
});
```

`vitest.config.ts`:

```ts
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*_test.ts', 'scripts/**/*_test.ts'],
    environment: 'node',
  },
});
```

`package.json` `scripts` becomes:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "mirror": "node scripts/mirror/run.ts",
    "perf": "node scripts/perf-import.ts"
  },
```

`.env.example`:

```
# Public Mapbox token, URL-restricted to the production domain.
VITE_MAPBOX_TOKEN=
# Base URL of the R2 bucket holding catalog.json, catalog.lock.json, feeds/*.zip
VITE_CATALOG_BASE_URL=
# mapbox (default) or fake (E2E tests)
VITE_MAP_PROVIDER=mapbox
```

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_CATALOG_BASE_URL?: string;
  readonly VITE_MAP_PROVIDER?: 'mapbox' | 'fake';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Append to `.gitignore`:

```
.env
test-results
playwright-report
```

- [ ] **Step 4: Write the failing tests**

`src/gtfs/time_test.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run src/gtfs/time_test.ts`
Expected: FAIL — cannot resolve `./time.ts`.

- [ ] **Step 6: Implement `src/gtfs/time.ts`**

```ts
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
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/gtfs/time_test.ts`
Expected: PASS (all tests).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.app.json tsconfig.node.json vite.config.ts vitest.config.ts .gitignore .env.example src/vite-env.d.ts src/gtfs
git commit -m "feat: add tooling and GTFS time/date helpers"
```

---

### Task 2: Service calendar resolution

**Files:**
- Create: `src/gtfs/service.ts`
- Test: `src/gtfs/service_test.ts`

**Interfaces:**
- Consumes: `addDays`, `weekdayOf`, `Weekday` from `src/gtfs/time.ts`.
- Produces:

```ts
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
export function activeServiceIds(calendar: readonly CalendarRow[], calendarDates: readonly CalendarDateRow[], date: string): Set<string>;
```

- [ ] **Step 1: Write the failing tests**

`src/gtfs/service_test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/gtfs/service_test.ts`
Expected: FAIL — cannot resolve `./service.ts`.

- [ ] **Step 3: Implement `src/gtfs/service.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/gtfs/service_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gtfs/service.ts src/gtfs/service_test.ts
git commit -m "feat: resolve active service ids for a date"
```

---

### Task 3: Streaming CSV parser

**Files:**
- Create: `src/gtfs/csv.ts`
- Test: `src/gtfs/csv_test.ts`

**Interfaces:**
- Produces:

```ts
export type CsvRecordHandler = (fields: string[], line: number) => void;
export type CsvErrorHandler = (line: number, message: string) => void;
export class CsvParser {
  constructor(onRecord: CsvRecordHandler, onError: CsvErrorHandler);
  push(chunk: string): void;
  end(): void;
}
```

`line` is the 1-based physical line on which the record starts (header is line 1). Empty lines are skipped. A leading UTF-8 BOM is stripped.

- [ ] **Step 1: Write the failing tests**

`src/gtfs/csv_test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {CsvParser} from './csv.ts';

interface Parsed {
  readonly records: Array<{fields: string[]; line: number}>;
  readonly errors: Array<{line: number; message: string}>;
}

function parse(chunks: readonly string[]): Parsed {
  const records: Array<{fields: string[]; line: number}> = [];
  const errors: Array<{line: number; message: string}> = [];
  const parser = new CsvParser(
    (fields, line) => records.push({fields, line}),
    (line, message) => errors.push({line, message}),
  );
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return {records, errors};
}

const fieldsOf = (parsed: Parsed): string[][] => parsed.records.map((r) => r.fields);

describe('CsvParser', () => {
  it('parses simple records', () => {
    expect(fieldsOf(parse(['a,b,c\n1,2,3\n']))).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });
  it('handles quoted fields with commas, escaped quotes, and newlines', () => {
    const parsed = parse(['id,name\n1,"Main St, ""North""\nEntrance"\n2,x\n']);
    expect(fieldsOf(parsed)).toEqual([
      ['id', 'name'],
      ['1', 'Main St, "North"\nEntrance'],
      ['2', 'x'],
    ]);
    expect(parsed.records.map((r) => r.line)).toEqual([1, 2, 4]);
  });
  it('handles CRLF line endings', () => {
    expect(fieldsOf(parse(['a,b\r\n1,2\r\n']))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('strips a leading BOM', () => {
    expect(fieldsOf(parse(['﻿stop_id\n1\n']))).toEqual([['stop_id'], ['1']]);
  });
  it('keeps empty fields and handles a missing trailing newline', () => {
    expect(fieldsOf(parse(['a,,c\n,,']))).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });
  it('skips empty lines but counts them', () => {
    const parsed = parse(['a\n\n1\n\n']);
    expect(fieldsOf(parsed)).toEqual([['a'], ['1']]);
    expect(parsed.records.map((r) => r.line)).toEqual([1, 3]);
  });
  it('gives identical results however the input is chunked', () => {
    const text = '﻿id,name\r\n1,"a ""q"", b"\r\n2,"multi\r\nline"\r\n3,plain\r\n';
    const whole = parse([text]);
    for (let split = 0; split <= text.length; split++) {
      expect(parse([text.slice(0, split), text.slice(split)])).toEqual(whole);
    }
    expect(parse(text.split(''))).toEqual(whole);
  });
  it('reports an unterminated quote and still emits the record', () => {
    const parsed = parse(['a,b\n1,"oops\n']);
    expect(parsed.errors).toEqual([{line: 2, message: 'Unterminated quoted field'}]);
    expect(fieldsOf(parsed)).toEqual([
      ['a', 'b'],
      ['1', 'oops\n'],
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/gtfs/csv_test.ts`
Expected: FAIL — cannot resolve `./csv.ts`.

- [ ] **Step 3: Implement `src/gtfs/csv.ts`**

```ts
export type CsvRecordHandler = (fields: string[], line: number) => void;
export type CsvErrorHandler = (line: number, message: string) => void;

/**
 * Incremental RFC 4180 parser. Feed it decoded text in arbitrary chunks;
 * records are emitted synchronously as soon as they are complete.
 */
export class CsvParser {
  private readonly onRecord: CsvRecordHandler;
  private readonly onError: CsvErrorHandler;
  private field = '';
  private fields: string[] = [];
  private fieldQuoted = false;
  private inQuotes = false;
  /** Saw `"` inside a quoted field: either an escaped quote or the closing quote. */
  private quotePending = false;
  /** Last character was a record-ending `\r`; a following `\n` belongs to it. */
  private pendingCr = false;
  private sawText = false;
  private line = 1;
  private recordLine = 1;

  constructor(onRecord: CsvRecordHandler, onError: CsvErrorHandler) {
    this.onRecord = onRecord;
    this.onError = onError;
  }

  push(chunk: string): void {
    let text = chunk;
    if (!this.sawText) {
      if (text.length === 0) return;
      this.sawText = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.pendingCr) {
        this.pendingCr = false;
        if (ch === '\n') continue;
      }
      if (this.inQuotes) {
        if (this.quotePending) {
          this.quotePending = false;
          if (ch === '"') {
            this.field += '"';
            continue;
          }
          // The pending quote closed the field; handle `ch` as unquoted text.
          this.inQuotes = false;
        } else {
          if (ch === '"') {
            this.quotePending = true;
          } else {
            if (ch === '\n') this.line++;
            this.field += ch;
          }
          continue;
        }
      }
      if (ch === '"' && this.field.length === 0 && !this.fieldQuoted) {
        this.inQuotes = true;
        this.fieldQuoted = true;
      } else if (ch === ',') {
        this.endField();
      } else if (ch === '\n' || ch === '\r') {
        this.endRecord();
        this.line++;
        this.recordLine = this.line;
        if (ch === '\r') this.pendingCr = true;
      } else {
        this.field += ch;
      }
    }
  }

  end(): void {
    if (this.inQuotes && !this.quotePending) {
      this.onError(this.recordLine, 'Unterminated quoted field');
    }
    this.inQuotes = false;
    this.quotePending = false;
    this.endRecord();
  }

  private endField(): void {
    this.fields.push(this.field);
    this.field = '';
    this.fieldQuoted = false;
  }

  private endRecord(): void {
    if (this.fields.length === 0 && this.field.length === 0 && !this.fieldQuoted) return;
    this.endField();
    const fields = this.fields;
    this.fields = [];
    this.onRecord(fields, this.recordLine);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/gtfs/csv_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gtfs/csv.ts src/gtfs/csv_test.ts
git commit -m "feat: add streaming CSV parser"
```

---

### Task 4: GTFS schema, DDL, issue collection, and table writers

**Files:**
- Create: `src/gtfs/schema.ts`, `src/shared/types.ts`, `src/worker/sqlite.ts`, `src/worker/ddl.ts`, `src/worker/issues.ts`, `src/worker/table-writer.ts`, `src/test-fixtures/test-db.ts`
- Test: `src/worker/table-writer_test.ts`, `src/worker/issues_test.ts`

**Interfaces:**
- Consumes: `parseGtfsTime` (Task 1).
- Produces:

```ts
// src/gtfs/schema.ts
export type ColumnType = 'text' | 'int' | 'real' | 'time';
export interface ColumnDef { readonly name: string; readonly type: ColumnType; readonly required?: boolean }
export interface TableDef {
  readonly table: string;            // e.g. 'stop_times'
  readonly file: string;             // e.g. 'stop_times.txt'
  readonly requiredFile: boolean;
  readonly columns: readonly ColumnDef[];
  readonly indexes: readonly (readonly string[])[];
}
export const GTFS_TABLES: readonly TableDef[];
export function tableForFile(fileName: string): TableDef | undefined;
export function secsColumn(timeColumn: string): string;   // 'arrival_time' -> 'arrival_secs'

// src/shared/types.ts (first part; later tasks append)
export type IssueSeverity = 'fatal' | 'error' | 'warning';
export type IssueCode = 'missing_file' | 'missing_calendar' | 'missing_column' | 'missing_value'
  | 'empty_file' | 'duplicate_file' | 'ragged_row' | 'invalid_value' | 'csv_syntax'
  | 'zip_error' | 'invalid_timezone' | 'suppressed';
export interface ImportIssue {
  readonly severity: IssueSeverity; readonly file: string | null; readonly line: number | null;
  readonly column: string | null; readonly code: IssueCode; readonly message: string;
}

// src/worker/sqlite.ts
export type {Database, SqlValue} from '@sqlite.org/sqlite-wasm';
export function loadSqlite(): Promise<Sqlite3Static>;

// src/worker/ddl.ts
export function createGtfsTables(db: Database): void;   // GTFS tables + extra_files + import_issues
export function createGtfsIndexes(db: Database): void;

// src/worker/issues.ts
export class IssueCollector {
  constructor(db: Database, cap?: number);   // cap per (file, code), default 100
  add(issue: ImportIssue): void;
  hasFatal(): boolean;
  fatalIssues(): readonly ImportIssue[];
  totalCount(): number;
  finish(): void;   // writes "N more" summary rows, finalizes statement
}

// src/worker/table-writer.ts
export interface RowWriter { write(fields: readonly string[], line: number): void; finish(): number }
export class TxBatcher { constructor(db: Database, size: number); begin(): void; tick(): void; commit(): void }
export function createTableWriter(db: Database, def: TableDef, header: readonly string[], issues: IssueCollector, onRow: () => void): RowWriter | null;
export function createExtraFileWriter(db: Database, fileName: string, header: readonly string[], onRow: () => void): RowWriter;

// src/test-fixtures/test-db.ts
export function openMemoryDb(): Promise<Database>;
```

Table `import_issues(severity, file, line, column_name, code, message)`; table `extra_files(file_name, line, json)`.

- [ ] **Step 1: Create `src/gtfs/schema.ts`**

```ts
export type ColumnType = 'text' | 'int' | 'real' | 'time';

export interface ColumnDef {
  readonly name: string;
  readonly type: ColumnType;
  readonly required?: boolean;
}

export interface TableDef {
  readonly table: string;
  readonly file: string;
  readonly requiredFile: boolean;
  readonly columns: readonly ColumnDef[];
  readonly indexes: readonly (readonly string[])[];
}

const text = (name: string, required = false): ColumnDef => ({name, type: 'text', required});
const int = (name: string, required = false): ColumnDef => ({name, type: 'int', required});
const real = (name: string, required = false): ColumnDef => ({name, type: 'real', required});
const time = (name: string, required = false): ColumnDef => ({name, type: 'time', required});

const WEEKDAY_COLUMNS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
].map((day) => int(day, true));

export const GTFS_TABLES: readonly TableDef[] = [
  {
    table: 'agency',
    file: 'agency.txt',
    requiredFile: true,
    columns: [
      text('agency_id'),
      text('agency_name', true),
      text('agency_url', true),
      text('agency_timezone', true),
      text('agency_lang'),
      text('agency_phone'),
      text('agency_fare_url'),
      text('agency_email'),
    ],
    indexes: [],
  },
  {
    table: 'stops',
    file: 'stops.txt',
    requiredFile: true,
    columns: [
      text('stop_id', true),
      text('stop_code'),
      text('stop_name'),
      text('tts_stop_name'),
      text('stop_desc'),
      real('stop_lat'),
      real('stop_lon'),
      text('zone_id'),
      text('stop_url'),
      int('location_type'),
      text('parent_station'),
      text('stop_timezone'),
      int('wheelchair_boarding'),
      text('level_id'),
      text('platform_code'),
    ],
    indexes: [['stop_id'], ['parent_station']],
  },
  {
    table: 'routes',
    file: 'routes.txt',
    requiredFile: true,
    columns: [
      text('route_id', true),
      text('agency_id'),
      text('route_short_name'),
      text('route_long_name'),
      text('route_desc'),
      int('route_type', true),
      text('route_url'),
      text('route_color'),
      text('route_text_color'),
      int('route_sort_order'),
      int('continuous_pickup'),
      int('continuous_drop_off'),
      text('network_id'),
    ],
    indexes: [['route_id']],
  },
  {
    table: 'trips',
    file: 'trips.txt',
    requiredFile: true,
    columns: [
      text('route_id', true),
      text('service_id', true),
      text('trip_id', true),
      text('trip_headsign'),
      text('trip_short_name'),
      int('direction_id'),
      text('block_id'),
      text('shape_id'),
      int('wheelchair_accessible'),
      int('bikes_allowed'),
    ],
    indexes: [['trip_id'], ['route_id'], ['shape_id'], ['service_id']],
  },
  {
    table: 'stop_times',
    file: 'stop_times.txt',
    requiredFile: true,
    columns: [
      text('trip_id', true),
      time('arrival_time'),
      time('departure_time'),
      text('stop_id', true),
      int('stop_sequence', true),
      text('stop_headsign'),
      int('pickup_type'),
      int('drop_off_type'),
      int('continuous_pickup'),
      int('continuous_drop_off'),
      real('shape_dist_traveled'),
      int('timepoint'),
    ],
    indexes: [['trip_id', 'stop_sequence'], ['stop_id']],
  },
  {
    table: 'calendar',
    file: 'calendar.txt',
    requiredFile: false,
    columns: [
      text('service_id', true),
      ...WEEKDAY_COLUMNS,
      text('start_date', true),
      text('end_date', true),
    ],
    indexes: [['service_id']],
  },
  {
    table: 'calendar_dates',
    file: 'calendar_dates.txt',
    requiredFile: false,
    columns: [text('service_id', true), text('date', true), int('exception_type', true)],
    indexes: [['service_id'], ['date']],
  },
  {
    table: 'shapes',
    file: 'shapes.txt',
    requiredFile: false,
    columns: [
      text('shape_id', true),
      real('shape_pt_lat', true),
      real('shape_pt_lon', true),
      int('shape_pt_sequence', true),
      real('shape_dist_traveled'),
    ],
    indexes: [['shape_id', 'shape_pt_sequence']],
  },
  {
    table: 'frequencies',
    file: 'frequencies.txt',
    requiredFile: false,
    columns: [
      text('trip_id', true),
      time('start_time', true),
      time('end_time', true),
      int('headway_secs', true),
      int('exact_times'),
    ],
    indexes: [['trip_id']],
  },
  {
    table: 'feed_info',
    file: 'feed_info.txt',
    requiredFile: false,
    columns: [
      text('feed_publisher_name', true),
      text('feed_publisher_url', true),
      text('feed_lang', true),
      text('default_lang'),
      text('feed_start_date'),
      text('feed_end_date'),
      text('feed_version'),
      text('feed_contact_email'),
      text('feed_contact_url'),
    ],
    indexes: [],
  },
];

const BY_FILE = new Map(GTFS_TABLES.map((def) => [def.file, def]));

export function tableForFile(fileName: string): TableDef | undefined {
  return BY_FILE.get(fileName);
}

/** Name of the integer-seconds companion column for a GTFS time column. */
export function secsColumn(timeColumn: string): string {
  return timeColumn.replace(/_time$/, '_secs');
}
```

- [ ] **Step 2: Create `src/shared/types.ts`**

```ts
export type IssueSeverity = 'fatal' | 'error' | 'warning';

export type IssueCode =
  | 'missing_file'
  | 'missing_calendar'
  | 'missing_column'
  | 'missing_value'
  | 'empty_file'
  | 'duplicate_file'
  | 'ragged_row'
  | 'invalid_value'
  | 'csv_syntax'
  | 'zip_error'
  | 'invalid_timezone'
  | 'suppressed';

export interface ImportIssue {
  readonly severity: IssueSeverity;
  readonly file: string | null;
  readonly line: number | null;
  readonly column: string | null;
  readonly code: IssueCode;
  readonly message: string;
}
```

- [ ] **Step 3: Create `src/worker/sqlite.ts` and `src/test-fixtures/test-db.ts`**

`src/worker/sqlite.ts`:

```ts
import sqlite3InitModule, {type Sqlite3Static} from '@sqlite.org/sqlite-wasm';

export type {Database, SqlValue} from '@sqlite.org/sqlite-wasm';

let loading: Promise<Sqlite3Static> | null = null;

/** Loads the sqlite-wasm module once per thread. */
export function loadSqlite(): Promise<Sqlite3Static> {
  loading ??= sqlite3InitModule();
  return loading;
}
```

`src/test-fixtures/test-db.ts`:

```ts
import {loadSqlite, type Database} from '../worker/sqlite.ts';

export async function openMemoryDb(): Promise<Database> {
  const sqlite3 = await loadSqlite();
  return new sqlite3.oo1.DB(':memory:');
}
```

- [ ] **Step 4: Write the failing tests**

`src/worker/table-writer_test.ts`:

```ts
import {beforeEach, describe, expect, it} from 'vitest';
import {tableForFile, type TableDef} from '../gtfs/schema.ts';
import {openMemoryDb} from '../test-fixtures/test-db.ts';
import {createGtfsIndexes, createGtfsTables} from './ddl.ts';
import {IssueCollector} from './issues.ts';
import type {Database} from './sqlite.ts';
import {createExtraFileWriter, createTableWriter} from './table-writer.ts';

function def(file: string): TableDef {
  const found = tableForFile(file);
  if (found === undefined) throw new Error(`no table for ${file}`);
  return found;
}

describe('table writers', () => {
  let db: Database;
  let issues: IssueCollector;
  let rows: number;

  beforeEach(async () => {
    db = await openMemoryDb();
    createGtfsTables(db);
    issues = new IssueCollector(db);
    rows = 0;
  });

  const onRow = (): void => {
    rows++;
  };

  it('creates every GTFS table plus time-seconds columns', () => {
    const columns = db.selectValues("SELECT name FROM pragma_table_info('stop_times')");
    expect(columns).toContain('arrival_time');
    expect(columns).toContain('arrival_secs');
    expect(columns).toContain('departure_secs');
    const tables = db.selectValues("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables).toEqual(
      expect.arrayContaining(['agency', 'stops', 'stop_times', 'extra_files', 'import_issues']),
    );
  });

  it('converts typed values and stores both time forms', () => {
    const header = ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'extra'];
    const writer = createTableWriter(db, def('stop_times.txt'), header, issues, onRow);
    if (writer === null) throw new Error('writer should exist');
    writer.write(['T1', '25:30:00', '', 'S1', '3', 'ignored'], 2);
    expect(writer.finish()).toBe(1);
    expect(rows).toBe(1);
    expect(
      db.selectObjects(
        'SELECT trip_id, arrival_time, arrival_secs, departure_time, departure_secs, stop_sequence FROM stop_times',
      ),
    ).toEqual([
      {
        trip_id: 'T1',
        arrival_time: '25:30:00',
        arrival_secs: 91800,
        departure_time: null,
        departure_secs: null,
        stop_sequence: 3,
      },
    ]);
  });

  it('records invalid values and ragged rows without dropping the row', () => {
    const header = ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'];
    const writer = createTableWriter(db, def('stops.txt'), header, issues, onRow);
    if (writer === null) throw new Error('writer should exist');
    writer.write(['S1', 'Main', 'north', '-122.1', 'x'], 2);
    writer.write(['S2', 'Short'], 3);
    writer.finish();
    expect(db.selectObjects('SELECT stop_id, stop_lat, location_type FROM stops')).toEqual([
      {stop_id: 'S1', stop_lat: null, location_type: null},
      {stop_id: 'S2', stop_lat: null, location_type: null},
    ]);
    expect(db.selectValues('SELECT code FROM import_issues ORDER BY rowid')).toEqual([
      'invalid_value',
      'invalid_value',
      'ragged_row',
    ]);
  });

  it('records a missing required value', () => {
    const writer = createTableWriter(db, def('stops.txt'), ['stop_id', 'stop_name'], issues, onRow);
    if (writer === null) throw new Error('writer should exist');
    writer.write(['', 'Nameless'], 2);
    writer.finish();
    expect(db.selectValue("SELECT count(*) FROM import_issues WHERE code = 'missing_value'")).toBe(1);
  });

  it('refuses a required file missing a required column (fatal)', () => {
    const header = ['trip_id', 'stop_id', 'arrival_time'];
    expect(createTableWriter(db, def('stop_times.txt'), header, issues, onRow)).toBeNull();
    expect(issues.hasFatal()).toBe(true);
    expect(issues.fatalIssues()[0]?.column).toBe('stop_sequence');
  });

  it('skips an optional file missing a required column (non-fatal)', () => {
    const header = ['shape_id', 'shape_pt_lat', 'shape_pt_lon'];
    expect(createTableWriter(db, def('shapes.txt'), header, issues, onRow)).toBeNull();
    expect(issues.hasFatal()).toBe(false);
    expect(issues.totalCount()).toBe(1);
  });

  it('stores unknown files as JSON rows', () => {
    const writer = createExtraFileWriter(db, 'transfers.txt', ['from_stop_id', 'to_stop_id'], onRow);
    writer.write(['A', 'B'], 2);
    writer.finish();
    expect(db.selectObjects('SELECT file_name, line, json FROM extra_files')).toEqual([
      {file_name: 'transfers.txt', line: 2, json: '{"from_stop_id":"A","to_stop_id":"B"}'},
    ]);
  });

  it('creates indexes after load', () => {
    createGtfsIndexes(db);
    const indexes = db.selectValues("SELECT name FROM sqlite_master WHERE type = 'index'");
    expect(indexes).toContain('idx_stop_times_stop_id');
    expect(indexes).toContain('idx_stop_times_trip_id_stop_sequence');
  });
});
```

`src/worker/issues_test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {openMemoryDb} from '../test-fixtures/test-db.ts';
import {createGtfsTables} from './ddl.ts';
import {IssueCollector} from './issues.ts';

describe('IssueCollector', () => {
  it('caps stored rows per file and code, then writes a summary row', async () => {
    const db = await openMemoryDb();
    createGtfsTables(db);
    const issues = new IssueCollector(db, 3);
    for (let line = 2; line < 12; line++) {
      issues.add({
        severity: 'warning',
        file: 'stops.txt',
        line,
        column: null,
        code: 'ragged_row',
        message: 'ragged',
      });
    }
    issues.finish();
    expect(issues.totalCount()).toBe(10);
    expect(db.selectValue("SELECT count(*) FROM import_issues WHERE code = 'ragged_row'")).toBe(3);
    expect(db.selectValue("SELECT message FROM import_issues WHERE code = 'suppressed'")).toBe(
      '7 more "ragged_row" issues in stops.txt were not recorded.',
    );
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run src/worker`
Expected: FAIL — cannot resolve `./ddl.ts`.

- [ ] **Step 6: Implement `src/worker/ddl.ts`**

```ts
import {GTFS_TABLES, secsColumn, type ColumnDef} from '../gtfs/schema.ts';
import type {Database} from './sqlite.ts';

function columnSql(column: ColumnDef): string {
  switch (column.type) {
    case 'int':
      return `${column.name} INTEGER`;
    case 'real':
      return `${column.name} REAL`;
    case 'time':
      return `${column.name} TEXT, ${secsColumn(column.name)} INTEGER`;
    case 'text':
      return `${column.name} TEXT`;
  }
}

export function createGtfsTables(db: Database): void {
  for (const def of GTFS_TABLES) {
    db.exec(`CREATE TABLE ${def.table} (${def.columns.map(columnSql).join(', ')})`);
  }
  db.exec(`
    CREATE TABLE extra_files (file_name TEXT NOT NULL, line INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE TABLE import_issues (
      severity TEXT NOT NULL,
      file TEXT,
      line INTEGER,
      column_name TEXT,
      code TEXT NOT NULL,
      message TEXT NOT NULL
    );
  `);
}

export function createGtfsIndexes(db: Database): void {
  for (const def of GTFS_TABLES) {
    for (const columns of def.indexes) {
      const name = `idx_${def.table}_${columns.join('_')}`;
      db.exec(`CREATE INDEX ${name} ON ${def.table} (${columns.join(', ')})`);
    }
  }
}
```

- [ ] **Step 7: Implement `src/worker/issues.ts`**

```ts
import type {PreparedStatement} from '@sqlite.org/sqlite-wasm';
import type {ImportIssue} from '../shared/types.ts';
import type {Database} from './sqlite.ts';

const DEFAULT_CAP = 100;

/** Records import issues, storing at most `cap` rows per (file, code) so broken feeds stay fast. */
export class IssueCollector {
  private readonly insert: PreparedStatement;
  private readonly cap: number;
  private readonly counts = new Map<string, {file: string | null; code: string; count: number}>();
  private readonly fatal: ImportIssue[] = [];
  private total = 0;

  constructor(db: Database, cap = DEFAULT_CAP) {
    this.cap = cap;
    this.insert = db.prepare(
      'INSERT INTO import_issues (severity, file, line, column_name, code, message) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }

  add(issue: ImportIssue): void {
    this.total++;
    if (issue.severity === 'fatal') this.fatal.push(issue);
    const key = `${issue.file ?? ''}\u0000${issue.code}`;
    const entry = this.counts.get(key) ?? {file: issue.file, code: issue.code, count: 0};
    entry.count++;
    this.counts.set(key, entry);
    if (entry.count > this.cap) return;
    this.insert
      .bind([issue.severity, issue.file, issue.line, issue.column, issue.code, issue.message])
      .stepReset();
  }

  hasFatal(): boolean {
    return this.fatal.length > 0;
  }

  fatalIssues(): readonly ImportIssue[] {
    return this.fatal;
  }

  totalCount(): number {
    return this.total;
  }

  finish(): void {
    for (const entry of this.counts.values()) {
      if (entry.count <= this.cap) continue;
      const where = entry.file === null ? '' : ` in ${entry.file}`;
      this.insert
        .bind([
          'warning',
          entry.file,
          null,
          null,
          'suppressed',
          `${entry.count - this.cap} more "${entry.code}" issues${where} were not recorded.`,
        ])
        .stepReset();
    }
    this.insert.finalize();
  }
}
```

- [ ] **Step 8: Implement `src/worker/table-writer.ts`**

```ts
import type {PreparedStatement} from '@sqlite.org/sqlite-wasm';
import {secsColumn, type ColumnDef, type TableDef} from '../gtfs/schema.ts';
import {parseGtfsTime} from '../gtfs/time.ts';
import type {IssueCollector} from './issues.ts';
import type {Database, SqlValue} from './sqlite.ts';

export interface RowWriter {
  write(fields: readonly string[], line: number): void;
  /** Finalizes the statement and returns the number of rows written. */
  finish(): number;
}

/** Commits every `size` rows so huge files don't build one giant transaction. */
export class TxBatcher {
  private readonly db: Database;
  private readonly size: number;
  private pending = 0;

  constructor(db: Database, size: number) {
    this.db = db;
    this.size = size;
  }

  begin(): void {
    this.db.exec('BEGIN');
  }

  tick(): void {
    this.pending++;
    if (this.pending >= this.size) {
      this.db.exec('COMMIT; BEGIN');
      this.pending = 0;
    }
  }

  commit(): void {
    this.db.exec('COMMIT');
    this.pending = 0;
  }
}

interface Converted {
  readonly value: SqlValue;
  readonly ok: boolean;
}

const INT_PATTERN = /^-?\d+$/;

function convert(type: ColumnDef['type'], raw: string): Converted {
  if (raw.length === 0) return {value: null, ok: true};
  switch (type) {
    case 'int':
      return INT_PATTERN.test(raw) ? {value: Number(raw), ok: true} : {value: null, ok: false};
    case 'real': {
      const value = Number(raw);
      return Number.isFinite(value) ? {value, ok: true} : {value: null, ok: false};
    }
    case 'time':
    case 'text':
      return {value: raw, ok: true};
  }
}

interface BoundColumn {
  readonly def: ColumnDef;
  readonly index: number;
}

export function createTableWriter(
  db: Database,
  def: TableDef,
  header: readonly string[],
  issues: IssueCollector,
  onRow: () => void,
): RowWriter | null {
  const positions = new Map(header.map((name, index) => [name, index]));
  const missing = def.columns.filter((c) => c.required === true && !positions.has(c.name));
  if (missing.length > 0) {
    for (const column of missing) {
      issues.add({
        severity: def.requiredFile ? 'fatal' : 'error',
        file: def.file,
        line: 1,
        column: column.name,
        code: 'missing_column',
        message: def.requiredFile
          ? `${def.file} is missing required column ${column.name}.`
          : `${def.file} is missing required column ${column.name}; the file was skipped.`,
      });
    }
    return null;
  }

  const bound: BoundColumn[] = [];
  for (const column of def.columns) {
    const index = positions.get(column.name);
    if (index !== undefined) bound.push({def: column, index});
  }
  const names = bound.flatMap((b) =>
    b.def.type === 'time' ? [b.def.name, secsColumn(b.def.name)] : [b.def.name],
  );
  const statement: PreparedStatement = db.prepare(
    `INSERT INTO ${def.table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
  );
  let count = 0;

  return {
    write(fields, line) {
      if (fields.length !== header.length) {
        issues.add({
          severity: 'warning',
          file: def.file,
          line,
          column: null,
          code: 'ragged_row',
          message: `Expected ${header.length} fields but found ${fields.length}.`,
        });
      }
      const values: SqlValue[] = [];
      for (const {def: column, index} of bound) {
        const raw = (fields[index] ?? '').trim();
        if (raw.length === 0 && column.required === true) {
          issues.add({
            severity: 'error',
            file: def.file,
            line,
            column: column.name,
            code: 'missing_value',
            message: `Required value ${column.name} is empty.`,
          });
        }
        const converted = convert(column.type, raw);
        if (!converted.ok) {
          issues.add({
            severity: 'warning',
            file: def.file,
            line,
            column: column.name,
            code: 'invalid_value',
            message: `"${raw}" is not a valid ${column.type} for ${column.name}.`,
          });
        }
        values.push(converted.value);
        if (column.type === 'time') {
          const secs = raw.length === 0 ? null : parseGtfsTime(raw);
          if (raw.length > 0 && secs === null) {
            issues.add({
              severity: 'warning',
              file: def.file,
              line,
              column: column.name,
              code: 'invalid_value',
              message: `"${raw}" is not a valid GTFS time for ${column.name}.`,
            });
          }
          values.push(secs);
        }
      }
      statement.bind(values).stepReset();
      count++;
      onRow();
    },
    finish() {
      statement.finalize();
      return count;
    },
  };
}

export function createExtraFileWriter(
  db: Database,
  fileName: string,
  header: readonly string[],
  onRow: () => void,
): RowWriter {
  const statement = db.prepare('INSERT INTO extra_files (file_name, line, json) VALUES (?, ?, ?)');
  let count = 0;
  return {
    write(fields, line) {
      const record = Object.fromEntries(header.map((name, i) => [name, fields[i] ?? '']));
      statement.bind([fileName, line, JSON.stringify(record)]).stepReset();
      count++;
      onRow();
    },
    finish() {
      statement.finalize();
      return count;
    },
  };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run src/worker`
Expected: PASS. (If `PreparedStatement` is not exported under that name, check `node_modules/@sqlite.org/sqlite-wasm/dist/index.d.mts` — it is declared as `export declare class PreparedStatement` in 3.53.4.)

- [ ] **Step 10: Commit**

```bash
git add src/gtfs/schema.ts src/shared/types.ts src/worker src/test-fixtures/test-db.ts
git commit -m "feat: add GTFS schema, DDL, issue collector, and table writers"
```

---
### Task 5: Zip loader and sample feed fixtures

**Files:**
- Create: `src/test-fixtures/sample-feed.ts`, `src/worker/loader.ts`
- Test: `src/worker/loader_test.ts`

**Interfaces:**
- Consumes: `CsvParser` (Task 3); `GTFS_TABLES`, `tableForFile` (Task 4); `createGtfsTables`, `createGtfsIndexes`, `IssueCollector`, `createTableWriter`, `createExtraFileWriter`, `TxBatcher` (Task 4).
- Produces:

```ts
// src/shared/types.ts (append)
export type ImportStage = 'parse' | 'index' | 'derive' | 'register';
export interface ImportProgress {
  readonly stage: ImportStage;
  readonly file?: string;
  readonly rowsDone?: number;
  readonly bytesDone?: number;
  readonly bytesTotal?: number | null;
}

// src/worker/loader.ts
export class NotZipError extends Error {}
export interface LoadOptions {
  readonly onProgress?: (progress: ImportProgress) => void;
  readonly bytesTotal?: number | null;
  readonly batchSize?: number;          // default 10_000
}
export interface LoadResult { readonly filesLoaded: readonly string[]; readonly fatal: boolean }
/** Expects createGtfsTables(db) to have been run. Creates indexes when not fatal. */
export function loadGtfsZip(db: Database, stream: ReadableStream<Uint8Array>, issues: IssueCollector, options?: LoadOptions): Promise<LoadResult>;

// src/test-fixtures/sample-feed.ts
export const SAMPLE_FEED: Readonly<Record<string, string>>;   // file name -> CSV text
export function makeZip(files: Readonly<Record<string, string>>): Uint8Array;
export function streamOf(bytes: Uint8Array, chunkSize?: number): ReadableStream<Uint8Array>;
export function withoutFile(name: string): Record<string, string>;
export function withFile(name: string, text: string): Record<string, string>;
```

`sample-feed.ts` depends only on `fflate` so the Playwright tests (Task 14) and the mirror tests (Task 15) can import it without loading SQLite. The SQLite-backed `loadSampleDb` helper is added in Task 6 in a separate file.

Sample feed facts later tasks rely on (service dates are YYYYMMDD):
- Agency `DTA`, timezone `America/Los_Angeles`.
- Stops: `STN` (station, location_type 1), `STN_A` (platform, parent `STN`), `BEATTY`, `NADAV`, `FUR`.
- Routes: `R10` short `10` long `Airport - Central` type 3 color `FF0000`; `R20` short `20` long `Central - Furnace Creek` type 3 color `#00FF00`; `R30` short `30` long `Harbor Ferry` type 4 color `green` (invalid), no trips.
- Trips: `T10_1`, `T10_2` (R10 dir 0, WKDY, shape SH10), `T10_3` (R10 dir 1, WKDY, SH10), `T20_1` (R20 dir 0, WKDY, no shape), `T20_2` (R20 dir 0, WKND, no shape).
- `T10_1` has a blank time at NADAV; `T10_2` runs 23:50 → 24:20; `T10_3` starts at `9:00:00`.
- Calendar: WKDY Mon–Fri, WKND Sat–Sun, both 20260101–20261231; 20261126 removes WKDY and adds WKND.
- Extra file `transfers.txt` (1 row).

- [ ] **Step 1: Create `src/test-fixtures/sample-feed.ts`**

```ts
import {strToU8, zipSync} from 'fflate';

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

export const SAMPLE_FEED: Readonly<Record<string, string>> = {
  'agency.txt': lines(
    'agency_id,agency_name,agency_url,agency_timezone',
    'DTA,Demo Transit Authority,https://example.com,America/Los_Angeles',
  ),
  'stops.txt': lines(
    'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station',
    'STN,Central Station,36.425288,-117.133162,1,',
    'STN_A,Central Station Platform A,36.4253,-117.1331,0,STN',
    'BEATTY,Beatty Airport,36.868446,-116.784582,0,',
    'NADAV,North Ave / D Ave N,36.914893,-116.76821,0,',
    'FUR,Furnace Creek,36.641496,-116.40094,0,',
  ),
  'routes.txt': lines(
    'route_id,agency_id,route_short_name,route_long_name,route_type,route_color',
    'R10,DTA,10,Airport - Central,3,FF0000',
    'R20,DTA,20,Central - Furnace Creek,3,#00FF00',
    'R30,DTA,30,Harbor Ferry,4,green',
  ),
  'trips.txt': lines(
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id',
    'R10,WKDY,T10_1,Central,0,SH10',
    'R10,WKDY,T10_2,Central,0,SH10',
    'R10,WKDY,T10_3,Airport,1,SH10',
    'R20,WKDY,T20_1,Furnace Creek,0,',
    'R20,WKND,T20_2,Furnace Creek,0,',
  ),
  'stop_times.txt': lines(
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'T10_1,08:00:00,08:00:00,BEATTY,1',
    'T10_1,,,NADAV,2',
    'T10_1,08:20:00,08:20:00,STN_A,3',
    'T10_2,23:50:00,23:50:00,BEATTY,1',
    'T10_2,24:05:00,24:05:00,NADAV,2',
    'T10_2,24:20:00,24:20:00,STN_A,3',
    'T10_3,9:00:00,9:00:00,STN_A,1',
    'T10_3,09:20:00,09:20:00,NADAV,2',
    'T10_3,09:30:00,09:30:00,BEATTY,3',
    'T20_1,10:00:00,10:00:00,STN_A,1',
    'T20_1,11:00:00,11:00:00,FUR,2',
    'T20_2,12:00:00,12:00:00,STN_A,1',
    'T20_2,13:00:00,13:00:00,FUR,2',
  ),
  'calendar.txt': lines(
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WKDY,1,1,1,1,1,0,0,20260101,20261231',
    'WKND,0,0,0,0,0,1,1,20260101,20261231',
  ),
  'calendar_dates.txt': lines(
    'service_id,date,exception_type',
    'WKDY,20261126,2',
    'WKND,20261126,1',
  ),
  'shapes.txt': lines(
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    'SH10,36.868446,-116.784582,1',
    'SH10,36.9,-116.77,2',
    'SH10,36.914893,-116.76821,3',
    'SH10,36.4253,-117.1331,4',
  ),
  'feed_info.txt': lines(
    'feed_publisher_name,feed_publisher_url,feed_lang,feed_version',
    'Demo Publisher,https://example.com,en,2026.10',
  ),
  'transfers.txt': lines('from_stop_id,to_stop_id,transfer_type', 'STN_A,FUR,0'),
};

export function makeZip(files: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

export function streamOf(bytes: Uint8Array, chunkSize = 4096): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

export function withoutFile(name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(SAMPLE_FEED).filter(([file]) => file !== name));
}

export function withFile(name: string, text: string): Record<string, string> {
  return {...SAMPLE_FEED, [name]: text};
}
```

- [ ] **Step 2: Append progress types to `src/shared/types.ts`**

```ts
export type ImportStage = 'parse' | 'index' | 'derive' | 'register';

export interface ImportProgress {
  readonly stage: ImportStage;
  readonly file?: string;
  readonly rowsDone?: number;
  readonly bytesDone?: number;
  readonly bytesTotal?: number | null;
}
```

- [ ] **Step 3: Write the failing tests**

`src/worker/loader_test.ts`:

```ts
import {strToU8, zipSync} from 'fflate';
import {beforeEach, describe, expect, it} from 'vitest';
import type {ImportProgress} from '../shared/types.ts';
import {
  makeZip,
  SAMPLE_FEED,
  streamOf,
  withFile,
  withoutFile,
} from '../test-fixtures/sample-feed.ts';
import {openMemoryDb} from '../test-fixtures/test-db.ts';
import {createGtfsTables} from './ddl.ts';
import {IssueCollector} from './issues.ts';
import {loadGtfsZip, NotZipError} from './loader.ts';
import type {Database} from './sqlite.ts';

const EXPECTED_COUNTS: Record<string, number> = {
  agency: 1,
  stops: 5,
  routes: 3,
  trips: 5,
  stop_times: 13,
  calendar: 2,
  calendar_dates: 2,
  shapes: 4,
  feed_info: 1,
  extra_files: 1,
};

function counts(db: Database): Record<string, number> {
  return Object.fromEntries(
    Object.keys(EXPECTED_COUNTS).map((table) => [
      table,
      Number(db.selectValue(`SELECT count(*) FROM ${table}`)),
    ]),
  );
}

describe('loadGtfsZip', () => {
  let db: Database;
  let issues: IssueCollector;

  beforeEach(async () => {
    db = await openMemoryDb();
    createGtfsTables(db);
    issues = new IssueCollector(db);
  });

  it('loads every file of the sample feed', async () => {
    const result = await loadGtfsZip(db, streamOf(makeZip(SAMPLE_FEED)), issues);
    expect(result.fatal).toBe(false);
    expect([...result.filesLoaded].sort()).toEqual(Object.keys(SAMPLE_FEED).sort());
    expect(counts(db)).toEqual(EXPECTED_COUNTS);
  });

  it('stores time seconds, including blanks and single-digit hours', async () => {
    await loadGtfsZip(db, streamOf(makeZip(SAMPLE_FEED)), issues);
    const secs = (trip: string, seq: number): unknown =>
      db.selectValue('SELECT departure_secs FROM stop_times WHERE trip_id = ? AND stop_sequence = ?', [
        trip,
        seq,
      ]);
    expect(secs('T10_2', 2)).toBe(86700);
    expect(secs('T10_3', 1)).toBe(32400);
    expect(secs('T10_1', 2)).toBeNull();
    expect(issues.totalCount()).toBe(0);
  });

  it('gives the same result with tiny chunks', async () => {
    await loadGtfsZip(db, streamOf(makeZip(SAMPLE_FEED), 7), issues);
    expect(counts(db)).toEqual(EXPECTED_COUNTS);
  });

  it('commits across batch boundaries', async () => {
    await loadGtfsZip(db, streamOf(makeZip(SAMPLE_FEED)), issues, {batchSize: 2});
    expect(counts(db)).toEqual(EXPECTED_COUNTS);
  });

  it('finds files inside a folder and ignores macOS junk', async () => {
    const nested: Record<string, Uint8Array> = {
      '__MACOSX/gtfs/._stops.txt': strToU8('junk'),
      'gtfs/': new Uint8Array(0),
    };
    for (const [name, text] of Object.entries(SAMPLE_FEED)) nested[`gtfs/${name}`] = strToU8(text);
    const result = await loadGtfsZip(db, streamOf(zipSync(nested)), issues);
    expect(result.fatal).toBe(false);
    expect(counts(db)).toEqual(EXPECTED_COUNTS);
    expect(issues.totalCount()).toBe(0);
  });

  it('rejects data that is not a zip', async () => {
    await expect(loadGtfsZip(db, streamOf(strToU8('stop_id\n1\n')), issues)).rejects.toBeInstanceOf(
      NotZipError,
    );
    await expect(loadGtfsZip(db, streamOf(new Uint8Array(0)), issues)).rejects.toBeInstanceOf(
      NotZipError,
    );
  });

  it('is fatal when a required file is missing', async () => {
    const result = await loadGtfsZip(db, streamOf(makeZip(withoutFile('stops.txt'))), issues);
    expect(result.fatal).toBe(true);
    expect(issues.fatalIssues().map((i) => i.code)).toEqual(['missing_file']);
  });

  it('is fatal when both calendar files are missing', async () => {
    const files = withoutFile('calendar.txt');
    delete files['calendar_dates.txt'];
    const result = await loadGtfsZip(db, streamOf(makeZip(files)), issues);
    expect(result.fatal).toBe(true);
    expect(issues.fatalIssues().map((i) => i.code)).toEqual(['missing_calendar']);
  });

  it('is fatal when a required file is empty', async () => {
    const result = await loadGtfsZip(db, streamOf(makeZip(withFile('routes.txt', ''))), issues);
    expect(result.fatal).toBe(true);
    expect(issues.fatalIssues().map((i) => i.code)).toEqual(['empty_file']);
  });

  it('skips an optional file with a missing required column', async () => {
    const shapes = 'shape_id,shape_pt_lat,shape_pt_lon\nSH10,1,2\n';
    const result = await loadGtfsZip(db, streamOf(makeZip(withFile('shapes.txt', shapes))), issues);
    expect(result.fatal).toBe(false);
    expect(db.selectValue('SELECT count(*) FROM shapes')).toBe(0);
  });

  it('reports progress up to the full byte count, then indexing', async () => {
    const zip = makeZip(SAMPLE_FEED);
    const events: ImportProgress[] = [];
    await loadGtfsZip(db, streamOf(zip, 512), issues, {
      bytesTotal: zip.length,
      onProgress: (p) => events.push(p),
    });
    const parse = events.filter((e) => e.stage === 'parse');
    expect(parse.at(-1)?.bytesDone).toBe(zip.length);
    expect(parse.at(-1)?.bytesTotal).toBe(zip.length);
    expect(events.at(-1)?.stage).toBe('index');
    expect(db.selectValues("SELECT name FROM sqlite_master WHERE type = 'index'")).toContain(
      'idx_stop_times_stop_id',
    );
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/worker/loader_test.ts`
Expected: FAIL — cannot resolve `./loader.ts`.

- [ ] **Step 5: Implement `src/worker/loader.ts`**

```ts
import {Unzip, UnzipInflate} from 'fflate';
import {CsvParser} from '../gtfs/csv.ts';
import {GTFS_TABLES, tableForFile} from '../gtfs/schema.ts';
import type {ImportProgress} from '../shared/types.ts';
import {createGtfsIndexes} from './ddl.ts';
import type {IssueCollector} from './issues.ts';
import type {Database} from './sqlite.ts';
import {
  createExtraFileWriter,
  createTableWriter,
  TxBatcher,
  type RowWriter,
} from './table-writer.ts';

export class NotZipError extends Error {
  constructor() {
    super('The file is not a zip archive.');
    this.name = 'NotZipError';
  }
}

export interface LoadOptions {
  readonly onProgress?: (progress: ImportProgress) => void;
  readonly bytesTotal?: number | null;
  readonly batchSize?: number;
}

export interface LoadResult {
  readonly filesLoaded: readonly string[];
  readonly fatal: boolean;
}

const DEFAULT_BATCH_SIZE = 10_000;
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/** Base file name for a zip entry, or null for directories and macOS metadata. */
function entryBaseName(path: string): string | null {
  if (path.endsWith('/')) return null;
  const segments = path.split('/');
  if (segments.includes('__MACOSX')) return null;
  const base = segments[segments.length - 1] ?? '';
  if (base.length === 0 || base.startsWith('._')) return null;
  return base;
}

interface FileConsumer {
  push(chunk: Uint8Array, final: boolean): void;
}

function createFileConsumer(
  db: Database,
  name: string,
  issues: IssueCollector,
  onRow: () => void,
): FileConsumer | null {
  const def = tableForFile(name);
  if (def === undefined && !/\.(txt|csv)$/i.test(name)) return null;
  const decoder = new TextDecoder('utf-8');
  let header: string[] | null = null;
  let writer: RowWriter | null = null;
  const parser = new CsvParser(
    (fields, line) => {
      if (header === null) {
        header = fields.map((field) => field.trim());
        writer =
          def === undefined
            ? createExtraFileWriter(db, name, header, onRow)
            : createTableWriter(db, def, header, issues, onRow);
        return;
      }
      writer?.write(fields, line);
    },
    (line, message) =>
      issues.add({severity: 'error', file: name, line, column: null, code: 'csv_syntax', message}),
  );
  return {
    push(chunk, final) {
      parser.push(decoder.decode(chunk, {stream: true}));
      if (!final) return;
      parser.push(decoder.decode());
      parser.end();
      writer?.finish();
      if (header === null && def !== undefined) {
        issues.add({
          severity: def.requiredFile ? 'fatal' : 'warning',
          file: name,
          line: null,
          column: null,
          code: 'empty_file',
          message: `${name} is empty.`,
        });
      }
    },
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

export async function loadGtfsZip(
  db: Database,
  stream: ReadableStream<Uint8Array>,
  issues: IssueCollector,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const batcher = new TxBatcher(db, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const seen = new Set<string>();
  const filesLoaded: string[] = [];
  let currentFile: string | undefined;
  let rowsDone = 0;
  let bytesDone = 0;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    const name = entryBaseName(file.name);
    if (name === null) return;
    if (seen.has(name)) {
      issues.add({
        severity: 'warning',
        file: name,
        line: null,
        column: null,
        code: 'duplicate_file',
        message: `Ignored a second copy of ${name} at ${file.name}.`,
      });
      return;
    }
    seen.add(name);
    const consumer = createFileConsumer(db, name, issues, () => {
      rowsDone++;
      batcher.tick();
    });
    if (consumer === null) return;
    currentFile = name;
    rowsDone = 0;
    file.ondata = (error, chunk, final) => {
      if (error !== null) {
        issues.add({
          severity: 'error',
          file: name,
          line: null,
          column: null,
          code: 'zip_error',
          message: error.message,
        });
        return;
      }
      consumer.push(chunk, final);
      if (final) filesLoaded.push(name);
    };
    file.start();
  };

  const reader = stream.getReader();
  let head = new Uint8Array(0);
  let checked = false;
  // On error the caller discards the whole database, so no rollback is needed.
  batcher.begin();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    let chunk = value;
    if (!checked) {
      head = concat(head, value);
      if (head.length < ZIP_SIGNATURE.length) continue;
      if (!hasZipSignature(head)) {
        await reader.cancel();
        throw new NotZipError();
      }
      checked = true;
      chunk = head;
    }
    bytesDone += chunk.length;
    unzip.push(chunk, false);
    options.onProgress?.({
      stage: 'parse',
      file: currentFile,
      rowsDone,
      bytesDone,
      bytesTotal: options.bytesTotal ?? null,
    });
  }
  if (!checked) throw new NotZipError();
  unzip.push(new Uint8Array(0), true);
  batcher.commit();

  for (const def of GTFS_TABLES) {
    if (def.requiredFile && !seen.has(def.file)) {
      issues.add({
        severity: 'fatal',
        file: def.file,
        line: null,
        column: null,
        code: 'missing_file',
        message: `Required file ${def.file} is missing.`,
      });
    }
  }
  if (!seen.has('calendar.txt') && !seen.has('calendar_dates.txt')) {
    issues.add({
      severity: 'fatal',
      file: null,
      line: null,
      column: null,
      code: 'missing_calendar',
      message: 'Either calendar.txt or calendar_dates.txt is required.',
    });
  }

  const fatal = issues.hasFatal();
  if (!fatal) {
    options.onProgress?.({stage: 'index'});
    createGtfsIndexes(db);
  }
  return {filesLoaded, fatal};
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/worker`
Expected: PASS (all loader, table-writer, and issues tests).

- [ ] **Step 7: Commit**

```bash
git add src/worker/loader.ts src/worker/loader_test.ts src/test-fixtures src/shared/types.ts
git commit -m "feat: stream GTFS zips into SQLite tables"
```

---

### Task 6: Derived tables

**Files:**
- Create: `src/worker/derive.ts`, `src/worker/sql-values.ts`, `src/test-fixtures/sample-db.ts`
- Test: `src/worker/derive_test.ts`

**Interfaces:**
- Consumes: `IssueCollector`, `createGtfsTables`, `openMemoryDb` (Task 4); `loadGtfsZip`, `SAMPLE_FEED`, `makeZip`, `streamOf`, `withFile` (Task 5).
- Produces:

```ts
// src/worker/derive.ts
export function buildDerivedTables(db: Database, issues: IssueCollector): void;

// src/worker/sql-values.ts
export function asString(value: SqlValue | undefined): string | null;
export function asNumber(value: SqlValue | undefined): number | null;

// src/test-fixtures/sample-db.ts
/** Loads a feed into a fresh in-memory DB and builds derived tables. */
export function loadSampleDb(files?: Readonly<Record<string, string>>): Promise<{db: Database; issues: IssueCollector}>;
```

Tables created:
- `route_patterns(pattern_id TEXT PRIMARY KEY, route_id, direction_id INTEGER, stop_ids_json TEXT, trip_count INTEGER, rep_trip_id, shape_id, headsign)` — `pattern_id` = `<route_id>:<direction_id>:<n>` with `n` starting at 1 in descending trip-count order.
- `route_shapes(route_id, shape_id, geojson, PRIMARY KEY(route_id, shape_id))` — `geojson` is a GeoJSON `LineString` string, coordinates rounded to 6 decimals. Synthesized shapes use `shape_id` = `stops:<pattern_id>`.
- `stop_routes(stop_id, route_id, PRIMARY KEY(stop_id, route_id))` — includes parent stations.
- `feed_summary(key TEXT PRIMARY KEY, value TEXT)` — keys `count:<table>` for every GTFS table, `service_start`, `service_end`, `timezone` (absent when invalid).

- [ ] **Step 1: Write the failing tests**

`src/worker/derive_test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {loadSampleDb} from '../test-fixtures/sample-db.ts';
import {SAMPLE_FEED, withFile} from '../test-fixtures/sample-feed.ts';

describe('buildDerivedTables', () => {
  it('groups trips into stop patterns', async () => {
    const {db} = await loadSampleDb();
    expect(
      db.selectObjects(
        'SELECT pattern_id, route_id, direction_id, stop_ids_json, trip_count, shape_id, headsign FROM route_patterns ORDER BY pattern_id',
      ),
    ).toEqual([
      {
        pattern_id: 'R10:0:1',
        route_id: 'R10',
        direction_id: 0,
        stop_ids_json: '["BEATTY","NADAV","STN_A"]',
        trip_count: 2,
        shape_id: 'SH10',
        headsign: 'Central',
      },
      {
        pattern_id: 'R10:1:1',
        route_id: 'R10',
        direction_id: 1,
        stop_ids_json: '["STN_A","NADAV","BEATTY"]',
        trip_count: 1,
        shape_id: 'SH10',
        headsign: 'Airport',
      },
      {
        pattern_id: 'R20:0:1',
        route_id: 'R20',
        direction_id: 0,
        stop_ids_json: '["STN_A","FUR"]',
        trip_count: 2,
        shape_id: null,
        headsign: 'Furnace Creek',
      },
    ]);
  });

  it('builds route geometry from shapes, or from stops when a trip has no shape', async () => {
    const {db} = await loadSampleDb();
    const rows = db.selectObjects('SELECT route_id, shape_id, geojson FROM route_shapes ORDER BY route_id');
    expect(rows.map((r) => [r['route_id'], r['shape_id']])).toEqual([
      ['R10', 'SH10'],
      ['R20', 'stops:R20:0:1'],
    ]);
    expect(JSON.parse(String(rows[0]?.['geojson']))).toEqual({
      type: 'LineString',
      coordinates: [
        [-116.784582, 36.868446],
        [-116.77, 36.9],
        [-116.76821, 36.914893],
        [-117.1331, 36.4253],
      ],
    });
    expect(JSON.parse(String(rows[1]?.['geojson']))).toEqual({
      type: 'LineString',
      coordinates: [
        [-117.1331, 36.4253],
        [-116.40094, 36.641496],
      ],
    });
  });

  it('maps stops (and their parent stations) to routes', async () => {
    const {db} = await loadSampleDb();
    const routesAt = (stop: string): unknown[] =>
      db.selectValues('SELECT route_id FROM stop_routes WHERE stop_id = ? ORDER BY route_id', [stop]);
    expect(routesAt('STN_A')).toEqual(['R10', 'R20']);
    expect(routesAt('STN')).toEqual(['R10', 'R20']);
    expect(routesAt('FUR')).toEqual(['R20']);
  });

  it('summarizes counts, service range, and timezone', async () => {
    const {db} = await loadSampleDb();
    const summary = Object.fromEntries(
      db.selectObjects('SELECT key, value FROM feed_summary').map((r) => [r['key'], r['value']]),
    );
    expect(summary['count:stops']).toBe('5');
    expect(summary['count:stop_times']).toBe('13');
    expect(summary['count:frequencies']).toBe('0');
    expect(summary['service_start']).toBe('20260101');
    expect(summary['service_end']).toBe('20261231');
    expect(summary['timezone']).toBe('America/Los_Angeles');
  });

  it('flags an invalid agency timezone', async () => {
    const agency = SAMPLE_FEED['agency.txt']?.replace('America/Los_Angeles', 'Mars/Olympus') ?? '';
    const {db, issues} = await loadSampleDb(withFile('agency.txt', agency));
    expect(db.selectValue("SELECT value FROM feed_summary WHERE key = 'timezone'")).toBeUndefined();
    expect(issues.totalCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Create the SQLite-backed fixture helper `src/test-fixtures/sample-db.ts`**

```ts
import {createGtfsTables} from '../worker/ddl.ts';
import {buildDerivedTables} from '../worker/derive.ts';
import {IssueCollector} from '../worker/issues.ts';
import {loadGtfsZip} from '../worker/loader.ts';
import type {Database} from '../worker/sqlite.ts';
import {makeZip, SAMPLE_FEED, streamOf} from './sample-feed.ts';
import {openMemoryDb} from './test-db.ts';

/** Loads a feed into a fresh in-memory DB and builds derived tables. */
export async function loadSampleDb(
  files: Readonly<Record<string, string>> = SAMPLE_FEED,
): Promise<{db: Database; issues: IssueCollector}> {
  const db = await openMemoryDb();
  createGtfsTables(db);
  const issues = new IssueCollector(db);
  const result = await loadGtfsZip(db, streamOf(makeZip(files)), issues);
  if (result.fatal) throw new Error('sample feed failed to load');
  buildDerivedTables(db, issues);
  return {db, issues};
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/worker/derive_test.ts`
Expected: FAIL — cannot resolve `../worker/derive.ts`.

- [ ] **Step 4: Implement `src/worker/derive.ts`**

```ts
import {GTFS_TABLES} from '../gtfs/schema.ts';
import type {IssueCollector} from './issues.ts';
import type {Database} from './sqlite.ts';
import {asNumber, asString} from './sql-values.ts';

type Position = [number, number];

const UNIT_SEPARATOR = '\u001f';

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function lineString(coordinates: readonly Position[]): string {
  return JSON.stringify({type: 'LineString', coordinates});
}

function buildPatterns(db: Database): void {
  db.exec(`
    CREATE TABLE route_patterns (
      pattern_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      direction_id INTEGER NOT NULL,
      stop_ids_json TEXT NOT NULL,
      trip_count INTEGER NOT NULL,
      rep_trip_id TEXT NOT NULL,
      shape_id TEXT,
      headsign TEXT
    );
    CREATE TEMP TABLE trip_seq AS
      SELECT trip_id, group_concat(stop_id, char(31) ORDER BY stop_sequence) AS stop_key
      FROM stop_times GROUP BY trip_id;
  `);
  const groups = db.selectObjects(`
    SELECT t.route_id AS route_id, COALESCE(t.direction_id, 0) AS direction_id, s.stop_key AS stop_key,
           count(*) AS trip_count, min(t.trip_id) AS rep_trip_id
    FROM trips t JOIN temp.trip_seq s ON s.trip_id = t.trip_id
    WHERE t.route_id IS NOT NULL
    GROUP BY t.route_id, COALESCE(t.direction_id, 0), s.stop_key
    ORDER BY t.route_id, direction_id, trip_count DESC, rep_trip_id
  `);
  const repTrip = db.prepare('SELECT shape_id, trip_headsign FROM trips WHERE trip_id = ? LIMIT 1');
  const insert = db.prepare('INSERT INTO route_patterns VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const counters = new Map<string, number>();
  for (const group of groups) {
    const routeId = asString(group['route_id']) ?? '';
    const directionId = asNumber(group['direction_id']) ?? 0;
    const repTripId = asString(group['rep_trip_id']) ?? '';
    const key = `${routeId}:${directionId}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    let shapeId: string | null = null;
    let headsign: string | null = null;
    repTrip.bind([repTripId]);
    if (repTrip.step()) {
      const row = repTrip.get({});
      shapeId = asString(row['shape_id']);
      headsign = asString(row['trip_headsign']);
    }
    repTrip.reset();
    const stopIds = (asString(group['stop_key']) ?? '').split(UNIT_SEPARATOR);
    insert
      .bind([
        `${key}:${n}`,
        routeId,
        directionId,
        JSON.stringify(stopIds),
        asNumber(group['trip_count']) ?? 0,
        repTripId,
        shapeId,
        headsign,
      ])
      .stepReset();
  }
  repTrip.finalize();
  insert.finalize();
  db.exec('DROP TABLE temp.trip_seq; CREATE INDEX idx_route_patterns_route_id ON route_patterns (route_id);');
}

function buildShapes(db: Database): void {
  db.exec(`
    CREATE TABLE route_shapes (
      route_id TEXT NOT NULL,
      shape_id TEXT NOT NULL,
      geojson TEXT NOT NULL,
      PRIMARY KEY (route_id, shape_id)
    )
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO route_shapes VALUES (?, ?, ?)');
  const shapePoints = db.prepare(
    'SELECT shape_pt_lon, shape_pt_lat FROM shapes WHERE shape_id = ? AND shape_pt_lat IS NOT NULL AND shape_pt_lon IS NOT NULL ORDER BY shape_pt_sequence',
  );
  const cache = new Map<string, Position[]>();
  const coordsForShape = (shapeId: string): Position[] => {
    const cached = cache.get(shapeId);
    if (cached !== undefined) return cached;
    const coords: Position[] = [];
    shapePoints.bind([shapeId]);
    while (shapePoints.step()) {
      coords.push([round6(Number(shapePoints.get(0))), round6(Number(shapePoints.get(1)))]);
    }
    shapePoints.reset();
    cache.set(shapeId, coords);
    return coords;
  };

  const used = db.selectObjects(
    'SELECT DISTINCT route_id, shape_id FROM trips WHERE route_id IS NOT NULL AND shape_id IS NOT NULL',
  );
  for (const row of used) {
    const routeId = asString(row['route_id']) ?? '';
    const shapeId = asString(row['shape_id']) ?? '';
    const coords = coordsForShape(shapeId);
    if (coords.length >= 2) insert.bind([routeId, shapeId, lineString(coords)]).stepReset();
  }

  // Patterns whose representative trip has no usable shape get a line through their stops.
  const stopCoords = new Map<string, Position>();
  for (const stop of db.selectObjects(
    'SELECT stop_id, stop_lon, stop_lat FROM stops WHERE stop_lat IS NOT NULL AND stop_lon IS NOT NULL',
  )) {
    stopCoords.set(asString(stop['stop_id']) ?? '', [
      round6(asNumber(stop['stop_lon']) ?? 0),
      round6(asNumber(stop['stop_lat']) ?? 0),
    ]);
  }
  for (const pattern of db.selectObjects(
    'SELECT pattern_id, route_id, shape_id, stop_ids_json FROM route_patterns',
  )) {
    const shapeId = asString(pattern['shape_id']);
    if (shapeId !== null && coordsForShape(shapeId).length >= 2) continue;
    const stopIds: unknown = JSON.parse(asString(pattern['stop_ids_json']) ?? '[]');
    if (!Array.isArray(stopIds)) continue;
    const coords: Position[] = [];
    for (const stopId of stopIds) {
      const position = typeof stopId === 'string' ? stopCoords.get(stopId) : undefined;
      if (position !== undefined) coords.push(position);
    }
    if (coords.length < 2) continue;
    insert
      .bind([
        asString(pattern['route_id']) ?? '',
        `stops:${asString(pattern['pattern_id']) ?? ''}`,
        lineString(coords),
      ])
      .stepReset();
  }
  shapePoints.finalize();
  insert.finalize();
}

function buildStopRoutes(db: Database): void {
  db.exec(`
    CREATE TABLE stop_routes (
      stop_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      PRIMARY KEY (stop_id, route_id)
    ) WITHOUT ROWID;
    INSERT OR IGNORE INTO stop_routes
      SELECT DISTINCT st.stop_id, t.route_id
      FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id
      WHERE st.stop_id IS NOT NULL AND t.route_id IS NOT NULL;
    INSERT OR IGNORE INTO stop_routes
      SELECT DISTINCT s.parent_station, sr.route_id
      FROM stop_routes sr JOIN stops s ON s.stop_id = sr.stop_id
      WHERE s.parent_station IS NOT NULL;
  `);
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone});
    return true;
  } catch {
    return false;
  }
}

function buildSummary(db: Database, issues: IssueCollector): void {
  db.exec('CREATE TABLE feed_summary (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO feed_summary VALUES (?, ?)');
  for (const def of GTFS_TABLES) {
    const count = Number(db.selectValue(`SELECT count(*) FROM ${def.table}`));
    insert.bind([`count:${def.table}`, String(count)]).stepReset();
  }
  const range = db.selectObject(`
    SELECT min(d) AS start, max(d) AS end FROM (
      SELECT start_date AS d FROM calendar
      UNION ALL SELECT end_date FROM calendar
      UNION ALL SELECT date FROM calendar_dates WHERE exception_type = 1
    ) WHERE d IS NOT NULL
  `);
  const start = asString(range?.['start']);
  const end = asString(range?.['end']);
  if (start !== null) insert.bind(['service_start', start]).stepReset();
  if (end !== null) insert.bind(['service_end', end]).stepReset();
  const timeZone = asString(db.selectValue('SELECT agency_timezone FROM agency LIMIT 1'));
  if (timeZone !== null && isValidTimeZone(timeZone)) {
    insert.bind(['timezone', timeZone]).stepReset();
  } else {
    issues.add({
      severity: 'warning',
      file: 'agency.txt',
      line: null,
      column: 'agency_timezone',
      code: 'invalid_timezone',
      message: `"${timeZone ?? ''}" is not a valid time zone; the browser's time zone will be used.`,
    });
  }
  insert.finalize();
}

export function buildDerivedTables(db: Database, issues: IssueCollector): void {
  db.exec('BEGIN');
  buildPatterns(db);
  buildShapes(db);
  buildStopRoutes(db);
  buildSummary(db, issues);
  db.exec('COMMIT');
}
```

Create `src/worker/sql-values.ts`:

```ts
import type {SqlValue} from './sqlite.ts';

export function asString(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

export function asNumber(value: SqlValue | undefined): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker/derive.ts src/worker/derive_test.ts src/worker/sql-values.ts src/test-fixtures/sample-db.ts
git commit -m "feat: build route patterns, shapes, stop routes, and feed summary"
```

---

### Task 7: Read queries and route-type styling

**Files:**
- Create: `src/gtfs/route-types.ts`, `src/worker/queries.ts`
- Modify: `src/shared/types.ts` (append)
- Test: `src/gtfs/route-types_test.ts`, `src/worker/queries_test.ts`

**Interfaces:**
- Consumes: `activeServiceIds` (Task 2), `addDays` (Task 1), `asString`/`asNumber`, `loadSampleDb` (Task 6).
- Produces:

```ts
// src/gtfs/route-types.ts
export type RouteCategory = 'tram' | 'subway' | 'rail' | 'bus' | 'ferry' | 'cable' | 'aerial'
  | 'funicular' | 'trolleybus' | 'monorail' | 'other';
export const CATEGORY_LABELS: Readonly<Record<RouteCategory, string>>;
export const CATEGORY_COLORS: Readonly<Record<RouteCategory, string>>;
export function routeCategory(routeType: number): RouteCategory;
export function normalizeColor(raw: string | null): string | null;   // '#rrggbb' lowercase or null
export function contrastText(background: string): string;           // '#000000' | '#ffffff'
export function routeLabel(route: {readonly routeId: string; readonly shortName: string | null; readonly longName: string | null}): string;

// src/shared/types.ts (append)
export interface RouteSummary {
  readonly routeId: string; readonly agencyId: string | null;
  readonly shortName: string | null; readonly longName: string | null;
  readonly routeType: number; readonly category: RouteCategory;
  readonly color: string; readonly textColor: string; readonly sortOrder: number | null;
}
export interface StopRef { readonly stopId: string; readonly name: string; readonly lat: number | null; readonly lon: number | null }
export interface PatternSummary {
  readonly patternId: string; readonly directionId: number; readonly headsign: string | null;
  readonly tripCount: number; readonly shapeId: string | null; readonly stops: readonly StopRef[];
}
export interface RouteDetail { readonly route: RouteSummary; readonly patterns: readonly PatternSummary[] }
export interface StopInfo {
  readonly stopId: string; readonly name: string; readonly code: string | null;
  readonly lat: number | null; readonly lon: number | null;
  readonly locationType: number; readonly parentStation: string | null;
}
export interface StopDetail { readonly stop: StopInfo; readonly routes: readonly RouteSummary[] }
export interface Departure {
  readonly tripId: string; readonly stopId: string; readonly routeId: string;
  readonly routeShortName: string | null; readonly routeLongName: string | null;
  readonly routeColor: string; readonly routeTextColor: string;
  readonly headsign: string | null;
  /** Seconds past midnight of the requested service date; may exceed 86400. */
  readonly departureSecs: number;
}
export interface AgencyInfo { readonly name: string; readonly url: string | null; readonly timezone: string | null }
export interface FeedInfoRow { readonly publisherName: string | null; readonly version: string | null; readonly startDate: string | null; readonly endDate: string | null }
export interface FeedSummary {
  readonly agencies: readonly AgencyInfo[]; readonly feedInfo: FeedInfoRow | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly serviceStart: string | null; readonly serviceEnd: string | null;
  readonly timezone: string | null; readonly issueCount: number;
}
export interface RouteShapeProps { readonly routeId: string; readonly shapeId: string; readonly color: string; readonly name: string }
export interface StopProps { readonly stopId: string; readonly name: string; readonly locationType: number }

// src/worker/queries.ts
export function getFeedSummary(db: Database): FeedSummary;
export function getRoutes(db: Database): RouteSummary[];
export function getRouteShapesGeoJSON(db: Database): FeatureCollection<LineString, RouteShapeProps>;
export function getStopsGeoJSON(db: Database): FeatureCollection<Point, StopProps>;
export function getRouteDetail(db: Database, routeId: string): RouteDetail | null;
export function getStopDetail(db: Database, stopId: string): StopDetail | null;
export function getStopDepartures(db: Database, stopId: string, serviceDate: string): Departure[];
```

`routeLabel` returns `"<short> · <long>"`, or whichever exists, or the id. It lives in `src/gtfs/route-types.ts` so UI code can import it without touching worker modules.

- [ ] **Step 1: Write the failing tests**

`src/gtfs/route-types_test.ts`:

```ts
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
```

`src/worker/queries_test.ts`:

```ts
import {beforeAll, describe, expect, it} from 'vitest';
import {CATEGORY_COLORS} from '../gtfs/route-types.ts';
import {loadSampleDb} from '../test-fixtures/sample-db.ts';
import {
  getFeedSummary,
  getRouteDetail,
  getRoutes,
  getRouteShapesGeoJSON,
  getStopDepartures,
  getStopDetail,
  getStopsGeoJSON,
} from './queries.ts';
import type {Database} from './sqlite.ts';

let db: Database;

beforeAll(async () => {
  ({db} = await loadSampleDb());
});

const departures = (stop: string, date: string): Array<[string, number]> =>
  getStopDepartures(db, stop, date).map((d) => [d.tripId, d.departureSecs]);

describe('queries', () => {
  it('lists routes in display order with normalized colors', () => {
    const routes = getRoutes(db);
    expect(routes.map((r) => r.routeId)).toEqual(['R10', 'R20', 'R30']);
    expect(routes.map((r) => r.color)).toEqual(['#ff0000', '#00ff00', CATEGORY_COLORS.ferry]);
    expect(routes[0]?.textColor).toBe('#ffffff');
    expect(routes[2]?.category).toBe('ferry');
  });

  it('returns route lines as GeoJSON with display properties', () => {
    const shapes = getRouteShapesGeoJSON(db);
    expect(shapes.features.map((f) => f.properties)).toEqual([
      {routeId: 'R10', shapeId: 'SH10', color: '#ff0000', name: '10 · Airport - Central'},
      {routeId: 'R20', shapeId: 'stops:R20:0:1', color: '#00ff00', name: '20 · Central - Furnace Creek'},
    ]);
  });

  it('returns stops and stations as GeoJSON points', () => {
    const stops = getStopsGeoJSON(db);
    expect(stops.features).toHaveLength(5);
    expect(stops.features[0]?.geometry.type).toBe('Point');
  });

  it('describes a route with ordered stops per pattern', () => {
    const detail = getRouteDetail(db, 'R10');
    expect(detail?.route.routeId).toBe('R10');
    expect(detail?.patterns.map((p) => [p.patternId, p.tripCount, p.headsign])).toEqual([
      ['R10:0:1', 2, 'Central'],
      ['R10:1:1', 1, 'Airport'],
    ]);
    expect(detail?.patterns[0]?.stops.map((s) => s.name)).toEqual([
      'Beatty Airport',
      'North Ave / D Ave N',
      'Central Station Platform A',
    ]);
  });

  it('returns null for unknown routes and stops', () => {
    expect(getRouteDetail(db, 'NOPE')).toBeNull();
    expect(getStopDetail(db, 'NOPE')).toBeNull();
  });

  it('lists routes serving a parent station', () => {
    const detail = getStopDetail(db, 'STN');
    expect(detail?.stop.locationType).toBe(1);
    expect(detail?.routes.map((r) => r.routeId)).toEqual(['R10', 'R20']);
  });

  it('lists a station’s departures from its platforms, including after-midnight trips', () => {
    // Monday 2026-10-12.
    expect(departures('STN', '20261012')).toEqual([
      ['T10_1', 30000],
      ['T10_3', 32400],
      ['T20_1', 36000],
      ['T10_2', 87600],
    ]);
  });

  it('includes the previous service day’s trips that run past midnight', () => {
    // Tuesday: Monday's T10_2 reaches STN_A at 24:20 = 00:20 Tuesday.
    expect(departures('STN', '20261013')[0]).toEqual(['T10_2', 1200]);
  });

  it('skips blank times', () => {
    expect(departures('NADAV', '20261012')).toEqual([
      ['T10_3', 33600],
      ['T10_2', 86700],
    ]);
  });

  it('applies calendar exceptions', () => {
    // Thursday 2026-11-26: weekday service removed, weekend service added.
    expect(departures('STN', '20261126')).toEqual([
      ['T10_2', 1200],
      ['T20_2', 43200],
    ]);
  });

  it('summarizes the feed', () => {
    const summary = getFeedSummary(db);
    expect(summary.agencies).toEqual([
      {name: 'Demo Transit Authority', url: 'https://example.com', timezone: 'America/Los_Angeles'},
    ]);
    expect(summary.feedInfo?.version).toBe('2026.10');
    expect(summary.counts['stops']).toBe(5);
    expect(summary.serviceStart).toBe('20260101');
    expect(summary.timezone).toBe('America/Los_Angeles');
    expect(summary.issueCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/gtfs/route-types_test.ts src/worker/queries_test.ts`
Expected: FAIL — cannot resolve `./route-types.ts` / `./queries.ts`.

- [ ] **Step 3: Implement `src/gtfs/route-types.ts`**

```ts
export type RouteCategory =
  | 'tram'
  | 'subway'
  | 'rail'
  | 'bus'
  | 'ferry'
  | 'cable'
  | 'aerial'
  | 'funicular'
  | 'trolleybus'
  | 'monorail'
  | 'other';

export const CATEGORY_LABELS: Readonly<Record<RouteCategory, string>> = {
  tram: 'Tram',
  subway: 'Subway',
  rail: 'Rail',
  bus: 'Bus',
  ferry: 'Ferry',
  cable: 'Cable car',
  aerial: 'Aerial lift',
  funicular: 'Funicular',
  trolleybus: 'Trolleybus',
  monorail: 'Monorail',
  other: 'Other',
};

export const CATEGORY_COLORS: Readonly<Record<RouteCategory, string>> = {
  tram: '#d97706',
  subway: '#7c3aed',
  rail: '#1d4ed8',
  bus: '#0f766e',
  ferry: '#0284c7',
  cable: '#b45309',
  aerial: '#be185d',
  funicular: '#a16207',
  trolleybus: '#15803d',
  monorail: '#6d28d9',
  other: '#475569',
};

const BASIC: Readonly<Record<number, RouteCategory>> = {
  0: 'tram',
  1: 'subway',
  2: 'rail',
  3: 'bus',
  4: 'ferry',
  5: 'cable',
  6: 'aerial',
  7: 'funicular',
  11: 'trolleybus',
  12: 'monorail',
};

/** Maps basic and extended (Google) route types to a display category. */
export function routeCategory(routeType: number): RouteCategory {
  const basic = BASIC[routeType];
  if (basic !== undefined) return basic;
  if (routeType >= 100 && routeType < 200) return 'rail';
  if (routeType >= 200 && routeType < 300) return 'bus';
  if (routeType >= 400 && routeType < 500) return 'subway';
  if (routeType >= 700 && routeType < 800) return 'bus';
  if (routeType >= 800 && routeType < 900) return 'trolleybus';
  if (routeType >= 900 && routeType < 1000) return 'tram';
  if (routeType >= 1000 && routeType < 1300) return 'ferry';
  if (routeType >= 1300 && routeType < 1400) return 'aerial';
  if (routeType >= 1400 && routeType < 1500) return 'funicular';
  return 'other';
}

/** GTFS colors are 6 hex digits without '#'; tolerate a leading '#'. */
export function normalizeColor(raw: string | null): string | null {
  if (raw === null) return null;
  const hex = raw.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function contrastText(background: string): string {
  const hex = background.replace(/^#/, '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#ffffff';
}

export function routeLabel(route: {
  readonly routeId: string;
  readonly shortName: string | null;
  readonly longName: string | null;
}): string {
  if (route.shortName !== null && route.longName !== null) {
    return `${route.shortName} · ${route.longName}`;
  }
  return route.shortName ?? route.longName ?? route.routeId;
}
```

- [ ] **Step 4: Append query result types to `src/shared/types.ts`**

```ts
import type {RouteCategory} from '../gtfs/route-types.ts';
```

(Put that import at the top of the file.) Then append:

```ts
export interface RouteSummary {
  readonly routeId: string;
  readonly agencyId: string | null;
  readonly shortName: string | null;
  readonly longName: string | null;
  readonly routeType: number;
  readonly category: RouteCategory;
  readonly color: string;
  readonly textColor: string;
  readonly sortOrder: number | null;
}

export interface StopRef {
  readonly stopId: string;
  readonly name: string;
  readonly lat: number | null;
  readonly lon: number | null;
}

export interface PatternSummary {
  readonly patternId: string;
  readonly directionId: number;
  readonly headsign: string | null;
  readonly tripCount: number;
  readonly shapeId: string | null;
  readonly stops: readonly StopRef[];
}

export interface RouteDetail {
  readonly route: RouteSummary;
  readonly patterns: readonly PatternSummary[];
}

export interface StopInfo {
  readonly stopId: string;
  readonly name: string;
  readonly code: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly locationType: number;
  readonly parentStation: string | null;
}

export interface StopDetail {
  readonly stop: StopInfo;
  readonly routes: readonly RouteSummary[];
}

export interface Departure {
  readonly tripId: string;
  readonly stopId: string;
  readonly routeId: string;
  readonly routeShortName: string | null;
  readonly routeLongName: string | null;
  readonly routeColor: string;
  readonly routeTextColor: string;
  readonly headsign: string | null;
  /** Seconds past midnight of the requested service date; may exceed 86400. */
  readonly departureSecs: number;
}

export interface AgencyInfo {
  readonly name: string;
  readonly url: string | null;
  readonly timezone: string | null;
}

export interface FeedInfoRow {
  readonly publisherName: string | null;
  readonly version: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

export interface FeedSummary {
  readonly agencies: readonly AgencyInfo[];
  readonly feedInfo: FeedInfoRow | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly serviceStart: string | null;
  readonly serviceEnd: string | null;
  readonly timezone: string | null;
  readonly issueCount: number;
}

export interface RouteShapeProps {
  readonly routeId: string;
  readonly shapeId: string;
  readonly color: string;
  readonly name: string;
}

export interface StopProps {
  readonly stopId: string;
  readonly name: string;
  readonly locationType: number;
}
```

- [ ] **Step 5: Implement `src/worker/queries.ts`**

```ts
import type {FeatureCollection, LineString, Point} from 'geojson';
import {
  CATEGORY_COLORS,
  contrastText,
  normalizeColor,
  routeCategory,
  routeLabel,
} from '../gtfs/route-types.ts';
import {activeServiceIds, type CalendarDateRow, type CalendarRow} from '../gtfs/service.ts';
import {addDays} from '../gtfs/time.ts';
import type {
  Departure,
  FeedSummary,
  RouteDetail,
  RouteShapeProps,
  RouteSummary,
  StopDetail,
  StopProps,
  StopRef,
} from '../shared/types.ts';
import type {Database, SqlValue} from './sqlite.ts';
import {asNumber, asString} from './sql-values.ts';

type Row = Record<string, SqlValue>;

const SECONDS_PER_DAY = 86400;
const ROUTE_COLUMNS =
  'r.route_id, r.agency_id, r.route_short_name, r.route_long_name, r.route_type, r.route_color, r.route_text_color, r.route_sort_order';

function toRouteSummary(row: Row): RouteSummary {
  const routeType = asNumber(row['route_type']) ?? 3;
  const category = routeCategory(routeType);
  const color = normalizeColor(asString(row['route_color'])) ?? CATEGORY_COLORS[category];
  return {
    routeId: asString(row['route_id']) ?? '',
    agencyId: asString(row['agency_id']),
    shortName: asString(row['route_short_name']),
    longName: asString(row['route_long_name']),
    routeType,
    category,
    color,
    textColor: normalizeColor(asString(row['route_text_color'])) ?? contrastText(color),
    sortOrder: asNumber(row['route_sort_order']),
  };
}

function compareRoutes(a: RouteSummary, b: RouteSummary): number {
  if (a.sortOrder !== b.sortOrder) {
    if (a.sortOrder === null) return 1;
    if (b.sortOrder === null) return -1;
    return a.sortOrder - b.sortOrder;
  }
  return routeLabel(a).localeCompare(routeLabel(b), undefined, {numeric: true});
}

export function getRoutes(db: Database): RouteSummary[] {
  return db.selectObjects(`SELECT ${ROUTE_COLUMNS} FROM routes r`).map(toRouteSummary).sort(compareRoutes);
}

export function getRouteShapesGeoJSON(db: Database): FeatureCollection<LineString, RouteShapeProps> {
  const routes = new Map(getRoutes(db).map((route) => [route.routeId, route]));
  const features = db
    .selectObjects('SELECT route_id, shape_id, geojson FROM route_shapes ORDER BY route_id, shape_id')
    .map((row) => {
      const routeId = asString(row['route_id']) ?? '';
      const route = routes.get(routeId);
      const geometry: LineString = JSON.parse(asString(row['geojson']) ?? '{}');
      return {
        type: 'Feature' as const,
        geometry,
        properties: {
          routeId,
          shapeId: asString(row['shape_id']) ?? '',
          color: route?.color ?? CATEGORY_COLORS.other,
          name: route === undefined ? routeId : routeLabel(route),
        },
      };
    });
  return {type: 'FeatureCollection', features};
}

export function getStopsGeoJSON(db: Database): FeatureCollection<Point, StopProps> {
  const features = db
    .selectObjects(
      `SELECT stop_id, stop_name, stop_lat, stop_lon, location_type FROM stops
       WHERE stop_lat IS NOT NULL AND stop_lon IS NOT NULL AND COALESCE(location_type, 0) IN (0, 1)`,
    )
    .map((row) => {
      const stopId = asString(row['stop_id']) ?? '';
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [asNumber(row['stop_lon']) ?? 0, asNumber(row['stop_lat']) ?? 0],
        },
        properties: {
          stopId,
          name: asString(row['stop_name']) ?? stopId,
          locationType: asNumber(row['location_type']) ?? 0,
        },
      };
    });
  return {type: 'FeatureCollection', features};
}

export function getRouteDetail(db: Database, routeId: string): RouteDetail | null {
  const routeRow = db.selectObject(`SELECT ${ROUTE_COLUMNS} FROM routes r WHERE r.route_id = ?`, [routeId]);
  if (routeRow === undefined) return null;
  const patternRows = db.selectObjects(
    `SELECT pattern_id, direction_id, stop_ids_json, trip_count, shape_id, headsign
     FROM route_patterns WHERE route_id = ? ORDER BY direction_id, trip_count DESC, pattern_id`,
    [routeId],
  );
  const parsed = patternRows.map((row) => {
    const ids: unknown = JSON.parse(asString(row['stop_ids_json']) ?? '[]');
    return {row, stopIds: Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []};
  });
  const allIds = [...new Set(parsed.flatMap((p) => p.stopIds))];
  const stops = new Map<string, StopRef>();
  for (const row of db.selectObjects(
    'SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops WHERE stop_id IN (SELECT value FROM json_each(?))',
    [JSON.stringify(allIds)],
  )) {
    const stopId = asString(row['stop_id']) ?? '';
    stops.set(stopId, {
      stopId,
      name: asString(row['stop_name']) ?? stopId,
      lat: asNumber(row['stop_lat']),
      lon: asNumber(row['stop_lon']),
    });
  }
  return {
    route: toRouteSummary(routeRow),
    patterns: parsed.map(({row, stopIds}) => ({
      patternId: asString(row['pattern_id']) ?? '',
      directionId: asNumber(row['direction_id']) ?? 0,
      headsign: asString(row['headsign']),
      tripCount: asNumber(row['trip_count']) ?? 0,
      shapeId: asString(row['shape_id']),
      stops: stopIds.map((id) => stops.get(id) ?? {stopId: id, name: id, lat: null, lon: null}),
    })),
  };
}

export function getStopDetail(db: Database, stopId: string): StopDetail | null {
  const row = db.selectObject(
    'SELECT stop_id, stop_name, stop_code, stop_lat, stop_lon, location_type, parent_station FROM stops WHERE stop_id = ?',
    [stopId],
  );
  if (row === undefined) return null;
  const routes = db
    .selectObjects(
      `SELECT ${ROUTE_COLUMNS} FROM routes r JOIN stop_routes sr ON sr.route_id = r.route_id WHERE sr.stop_id = ?`,
      [stopId],
    )
    .map(toRouteSummary)
    .sort(compareRoutes);
  return {
    stop: {
      stopId,
      name: asString(row['stop_name']) ?? stopId,
      code: asString(row['stop_code']),
      lat: asNumber(row['stop_lat']),
      lon: asNumber(row['stop_lon']),
      locationType: asNumber(row['location_type']) ?? 0,
      parentStation: asString(row['parent_station']),
    },
    routes,
  };
}

function loadCalendars(db: Database): {calendar: CalendarRow[]; dates: CalendarDateRow[]} {
  const calendar = db.selectObjects('SELECT * FROM calendar').map((row) => ({
    service_id: asString(row['service_id']) ?? '',
    monday: asNumber(row['monday']),
    tuesday: asNumber(row['tuesday']),
    wednesday: asNumber(row['wednesday']),
    thursday: asNumber(row['thursday']),
    friday: asNumber(row['friday']),
    saturday: asNumber(row['saturday']),
    sunday: asNumber(row['sunday']),
    start_date: asString(row['start_date']),
    end_date: asString(row['end_date']),
  }));
  const dates = db.selectObjects('SELECT service_id, date, exception_type FROM calendar_dates').map((row) => ({
    service_id: asString(row['service_id']) ?? '',
    date: asString(row['date']),
    exception_type: asNumber(row['exception_type']),
  }));
  return {calendar, dates};
}

const DEPARTURES_SQL = `
  SELECT st.trip_id, st.stop_id, st.departure_secs, t.route_id, t.trip_headsign,
         ${ROUTE_COLUMNS}
  FROM stop_times st
  JOIN trips t ON t.trip_id = st.trip_id
  JOIN routes r ON r.route_id = t.route_id
  WHERE st.stop_id IN (SELECT stop_id FROM stops WHERE stop_id = ?1 OR parent_station = ?1)
    AND t.service_id IN (SELECT value FROM json_each(?2))
    AND st.departure_secs IS NOT NULL
    AND st.departure_secs >= ?3`;

/** Departures at a stop (or a station's platforms) on a service date, including late trips from the day before. */
export function getStopDepartures(db: Database, stopId: string, serviceDate: string): Departure[] {
  const {calendar, dates} = loadCalendars(db);
  const today = [...activeServiceIds(calendar, dates, serviceDate)];
  const yesterday = [...activeServiceIds(calendar, dates, addDays(serviceDate, -1))];
  const toDeparture = (row: Row, offset: number): Departure => {
    const route = toRouteSummary(row);
    return {
      tripId: asString(row['trip_id']) ?? '',
      stopId: asString(row['stop_id']) ?? '',
      routeId: route.routeId,
      routeShortName: route.shortName,
      routeLongName: route.longName,
      routeColor: route.color,
      routeTextColor: route.textColor,
      headsign: asString(row['trip_headsign']),
      departureSecs: (asNumber(row['departure_secs']) ?? 0) - offset,
    };
  };
  const result = [
    ...db
      .selectObjects(DEPARTURES_SQL, [stopId, JSON.stringify(yesterday), SECONDS_PER_DAY])
      .map((row) => toDeparture(row, SECONDS_PER_DAY)),
    ...db.selectObjects(DEPARTURES_SQL, [stopId, JSON.stringify(today), 0]).map((row) => toDeparture(row, 0)),
  ];
  return result.sort((a, b) => a.departureSecs - b.departureSecs || a.tripId.localeCompare(b.tripId));
}

export function getFeedSummary(db: Database): FeedSummary {
  const summary = new Map(
    db.selectObjects('SELECT key, value FROM feed_summary').map((row) => [
      asString(row['key']) ?? '',
      asString(row['value']),
    ]),
  );
  const counts: Record<string, number> = {};
  for (const [key, value] of summary) {
    if (key.startsWith('count:')) counts[key.slice('count:'.length)] = Number(value);
  }
  const info = db.selectObject(
    'SELECT feed_publisher_name, feed_version, feed_start_date, feed_end_date FROM feed_info LIMIT 1',
  );
  return {
    agencies: db.selectObjects('SELECT agency_name, agency_url, agency_timezone FROM agency').map((row) => ({
      name: asString(row['agency_name']) ?? '',
      url: asString(row['agency_url']),
      timezone: asString(row['agency_timezone']),
    })),
    feedInfo:
      info === undefined
        ? null
        : {
            publisherName: asString(info['feed_publisher_name']),
            version: asString(info['feed_version']),
            startDate: asString(info['feed_start_date']),
            endDate: asString(info['feed_end_date']),
          },
    counts,
    serviceStart: summary.get('service_start') ?? null,
    serviceEnd: summary.get('service_end') ?? null,
    timezone: summary.get('timezone') ?? null,
    issueCount: Number(db.selectValue("SELECT count(*) FROM import_issues WHERE code != 'suppressed'")),
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS (all suites so far).

- [ ] **Step 7: Commit**

```bash
git add src/gtfs/route-types.ts src/gtfs/route-types_test.ts src/worker/queries.ts src/worker/queries_test.ts src/shared/types.ts
git commit -m "feat: add feed read queries and route styling"
```

---

### Task 8: Feed store and feed service (import orchestration + registry)

**Files:**
- Create: `src/worker/feed-store.ts`, `src/worker/feed-service.ts`
- Modify: `src/shared/types.ts` (append)
- Test: `src/worker/feed-service_test.ts`

**Interfaces:**
- Consumes: everything in `src/worker` from Tasks 4–7.
- Produces:

```ts
// src/shared/types.ts (append)
export type FeedSourceKind = 'catalog' | 'url' | 'file';
export interface FeedRecord {
  readonly id: string; readonly name: string; readonly sourceKind: FeedSourceKind;
  readonly sourceRef: string;              // catalog id, URL, or file name
  readonly catalogSha256: string | null; readonly importedAt: string;   // ISO timestamp
  readonly serviceStart: string | null; readonly serviceEnd: string | null;
  readonly dbFilename: string;
}
export type ImportSource =
  | {readonly kind: 'catalog'; readonly id: string; readonly name: string; readonly url: string; readonly sha256: string | null}
  | {readonly kind: 'url'; readonly url: string}
  | {readonly kind: 'file'; readonly file: File};
export type ImportErrorCode = 'network' | 'http' | 'not_zip' | 'fatal_issues' | 'quota' | 'unknown';
export interface ImportFailure { readonly ok: false; readonly code: ImportErrorCode; readonly message: string; readonly issues: readonly ImportIssue[] }
export interface ImportSuccess { readonly ok: true; readonly feed: FeedRecord; readonly issueCount: number }
export type ImportResult = ImportSuccess | ImportFailure;
export interface StorageCheck { readonly ok: boolean; readonly availableBytes: number | null }

// src/worker/feed-store.ts
export interface FeedStore {
  open(filename: string): Database;    // creates when missing; repeated opens of an open file return the same handle
  close(filename: string): void;
  remove(filename: string): void;      // closes first if open
  list(): string[];
  prepareForNewDb(): Promise<void>;
}
export class MemoryFeedStore implements FeedStore { constructor(sqlite3: Sqlite3Static) }

// src/worker/feed-service.ts
export const META_FILENAME = '/meta.db';
export interface FeedServiceDeps {
  readonly fetch: (url: string) => Promise<Response>;
  readonly now: () => Date;
  readonly estimate: () => Promise<StorageEstimate>;
}
export class FeedService {
  constructor(store: FeedStore, deps: FeedServiceDeps);
  init(): void;
  listFeeds(): FeedRecord[];
  openFeed(id: string): FeedRecord | null;
  deleteFeed(id: string): void;
  checkStorage(bytes: number): Promise<StorageCheck>;
  importFeed(source: ImportSource, onProgress: (p: ImportProgress) => void): Promise<ImportResult>;
  getFeedSummary(feedId: string): FeedSummary;
  getRoutes(feedId: string): RouteSummary[];
  getRouteShapesGeoJSON(feedId: string): FeatureCollection<LineString, RouteShapeProps>;
  getStopsGeoJSON(feedId: string): FeatureCollection<Point, StopProps>;
  getRouteDetail(feedId: string, routeId: string): RouteDetail | null;
  getStopDetail(feedId: string, stopId: string): StopDetail | null;
  getStopDepartures(feedId: string, stopId: string, serviceDate: string): Departure[];
}
export function slugify(value: string): string;
```

Feed ids: catalog → catalog id; URL → `slugify(host + path)`; file → `slugify(name without .zip)`. Re-importing the same id replaces the feed. Query methods throw `Error('Feed not found: <id>')` for unknown ids; the UI always calls `openFeed` first.

- [ ] **Step 1: Append to `src/shared/types.ts`**

```ts
export type FeedSourceKind = 'catalog' | 'url' | 'file';

export interface FeedRecord {
  readonly id: string;
  readonly name: string;
  readonly sourceKind: FeedSourceKind;
  readonly sourceRef: string;
  readonly catalogSha256: string | null;
  readonly importedAt: string;
  readonly serviceStart: string | null;
  readonly serviceEnd: string | null;
  readonly dbFilename: string;
}

export type ImportSource =
  | {
      readonly kind: 'catalog';
      readonly id: string;
      readonly name: string;
      readonly url: string;
      readonly sha256: string | null;
    }
  | {readonly kind: 'url'; readonly url: string}
  | {readonly kind: 'file'; readonly file: File};

export type ImportErrorCode = 'network' | 'http' | 'not_zip' | 'fatal_issues' | 'quota' | 'unknown';

export interface ImportFailure {
  readonly ok: false;
  readonly code: ImportErrorCode;
  readonly message: string;
  readonly issues: readonly ImportIssue[];
}

export interface ImportSuccess {
  readonly ok: true;
  readonly feed: FeedRecord;
  readonly issueCount: number;
}

export type ImportResult = ImportSuccess | ImportFailure;

export interface StorageCheck {
  readonly ok: boolean;
  readonly availableBytes: number | null;
}
```

- [ ] **Step 2: Create `src/worker/feed-store.ts`**

```ts
import type {Sqlite3Static} from '@sqlite.org/sqlite-wasm';
import type {Database} from './sqlite.ts';

/** Where feed databases live. OPFS in the browser; memory in tests and scripts. */
export interface FeedStore {
  open(filename: string): Database;
  close(filename: string): void;
  remove(filename: string): void;
  list(): string[];
  prepareForNewDb(): Promise<void>;
}

/** Keeps every database open in memory; `close` is a no-op so data survives reopening. */
export class MemoryFeedStore implements FeedStore {
  private readonly sqlite3: Sqlite3Static;
  private readonly dbs = new Map<string, Database>();

  constructor(sqlite3: Sqlite3Static) {
    this.sqlite3 = sqlite3;
  }

  open(filename: string): Database {
    let db = this.dbs.get(filename);
    if (db === undefined) {
      db = new this.sqlite3.oo1.DB(':memory:');
      this.dbs.set(filename, db);
    }
    return db;
  }

  close(_filename: string): void {}

  remove(filename: string): void {
    this.dbs.get(filename)?.close();
    this.dbs.delete(filename);
  }

  list(): string[] {
    return [...this.dbs.keys()];
  }

  async prepareForNewDb(): Promise<void> {}
}
```

- [ ] **Step 3: Write the failing tests**

`src/worker/feed-service_test.ts`:

```ts
import {strToU8} from 'fflate';
import {beforeEach, describe, expect, it} from 'vitest';
import type {ImportProgress, ImportResult} from '../shared/types.ts';
import {makeZip, SAMPLE_FEED, withoutFile} from '../test-fixtures/sample-feed.ts';
import {FeedService, META_FILENAME, slugify} from './feed-service.ts';
import {MemoryFeedStore} from './feed-store.ts';
import {loadSqlite} from './sqlite.ts';

const NOW = new Date('2026-10-09T12:00:00Z');

function zipFile(name: string, files = SAMPLE_FEED): File {
  return new File([makeZip(files)], name, {type: 'application/zip'});
}

describe('FeedService', () => {
  let store: MemoryFeedStore;
  let service: FeedService;
  let fetchImpl: (url: string) => Promise<Response>;
  let clock: number;

  beforeEach(async () => {
    store = new MemoryFeedStore(await loadSqlite());
    fetchImpl = async () => new Response(makeZip(SAMPLE_FEED));
    clock = NOW.getTime();
    service = new FeedService(store, {
      fetch: (url) => fetchImpl(url),
      now: () => new Date(clock++),
      estimate: async () => ({quota: 1000, usage: 400}),
    });
    service.init();
  });

  const importFile = (name = 'demo-transit.zip', files = SAMPLE_FEED): Promise<ImportResult> =>
    service.importFeed({kind: 'file', file: zipFile(name, files)}, () => {});

  it('imports an uploaded file and registers it', async () => {
    const progress: ImportProgress[] = [];
    const result = await service.importFeed(
      {kind: 'file', file: zipFile('demo-transit.zip')},
      (p) => progress.push(p),
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.feed).toMatchObject({
      id: 'demo-transit',
      name: 'Demo Transit Authority',
      sourceKind: 'file',
      sourceRef: 'demo-transit.zip',
      serviceStart: '20260101',
      serviceEnd: '20261231',
    });
    expect(service.listFeeds()).toEqual([result.feed]);
    expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(['parse', 'index', 'derive', 'register']));
    expect(service.getRoutes('demo-transit').map((r) => r.routeId)).toEqual(['R10', 'R20', 'R30']);
  });

  it('imports from a catalog entry using the catalog name and checksum', async () => {
    const result = await service.importFeed(
      {kind: 'catalog', id: 'demo', name: 'Demo (catalog)', url: 'https://r2.test/feeds/demo.zip', sha256: 'abc'},
      () => {},
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.feed).toMatchObject({id: 'demo', name: 'Demo (catalog)', sourceKind: 'catalog', catalogSha256: 'abc'});
  });

  it('derives an id from a URL', async () => {
    const result = await service.importFeed({kind: 'url', url: 'https://agency.example.com/gtfs/feed.zip'}, () => {});
    if (!result.ok) throw new Error(result.message);
    expect(result.feed.id).toBe('agency-example-com-gtfs-feed-zip');
  });

  it('explains network (CORS) failures', async () => {
    fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const result = await service.importFeed({kind: 'url', url: 'https://blocked.test/feed.zip'}, () => {});
    expect(result).toMatchObject({ok: false, code: 'network'});
    expect(result.ok ? '' : result.message).toMatch(/upload/i);
  });

  it('reports HTTP errors', async () => {
    fetchImpl = async () => new Response('nope', {status: 404});
    const result = await service.importFeed({kind: 'url', url: 'https://x.test/feed.zip'}, () => {});
    expect(result).toMatchObject({ok: false, code: 'http'});
  });

  it('rejects non-zip files and leaves nothing behind', async () => {
    const file = new File([strToU8('stop_id\n1\n')], 'stops.txt');
    const result = await service.importFeed({kind: 'file', file}, () => {});
    expect(result).toMatchObject({ok: false, code: 'not_zip'});
    expect(store.list()).toEqual([META_FILENAME]);
  });

  it('returns fatal issues and leaves nothing behind', async () => {
    const result = await importFile('broken.zip', withoutFile('stops.txt'));
    expect(result).toMatchObject({ok: false, code: 'fatal_issues'});
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual(['missing_file']);
    expect(store.list()).toEqual([META_FILENAME]);
    expect(service.listFeeds()).toEqual([]);
  });

  it('replaces a feed on re-import and removes the old database', async () => {
    const first = await importFile();
    const second = await importFile();
    if (!first.ok || !second.ok) throw new Error('import failed');
    expect(second.feed.dbFilename).not.toBe(first.feed.dbFilename);
    expect(service.listFeeds()).toHaveLength(1);
    expect(store.list().sort()).toEqual([META_FILENAME, second.feed.dbFilename].sort());
  });

  it('opens, queries, and deletes feeds', async () => {
    const result = await importFile();
    if (!result.ok) throw new Error(result.message);
    expect(service.openFeed('demo-transit')).toEqual(result.feed);
    expect(service.openFeed('missing')).toBeNull();
    expect(service.getStopDetail('demo-transit', 'STN')?.routes).toHaveLength(2);
    service.deleteFeed('demo-transit');
    expect(service.listFeeds()).toEqual([]);
    expect(store.list()).toEqual([META_FILENAME]);
    expect(() => service.getRoutes('demo-transit')).toThrow('Feed not found: demo-transit');
  });

  it('removes orphaned feed databases at startup', async () => {
    store.open('/feeds/orphan-1.db');
    service.init();
    expect(store.list()).toEqual([META_FILENAME]);
  });

  it('checks storage headroom at 3x the download size', async () => {
    expect(await service.checkStorage(100)).toEqual({ok: true, availableBytes: 600});
    expect(await service.checkStorage(300)).toEqual({ok: false, availableBytes: 600});
  });

  it('slugifies ids', () => {
    expect(slugify('Bay Area 511 (Regional)')).toBe('bay-area-511-regional');
    expect(slugify('!!!')).toBe('feed');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/worker/feed-service_test.ts`
Expected: FAIL — cannot resolve `./feed-service.ts`.

- [ ] **Step 5: Implement `src/worker/feed-service.ts`**

```ts
import type {FeatureCollection, LineString, Point} from 'geojson';
import type {
  Departure,
  FeedRecord,
  FeedSourceKind,
  FeedSummary,
  ImportErrorCode,
  ImportFailure,
  ImportProgress,
  ImportResult,
  ImportSource,
  RouteDetail,
  RouteShapeProps,
  RouteSummary,
  StopDetail,
  StopProps,
  StorageCheck,
} from '../shared/types.ts';
import {createGtfsTables} from './ddl.ts';
import {buildDerivedTables} from './derive.ts';
import type {FeedStore} from './feed-store.ts';
import {IssueCollector} from './issues.ts';
import {loadGtfsZip, NotZipError} from './loader.ts';
import * as queries from './queries.ts';
import type {Database} from './sqlite.ts';

export const META_FILENAME = '/meta.db';
const FEED_PREFIX = '/feeds/';
const STORAGE_HEADROOM = 3;
const CORS_MESSAGE =
  "Couldn't download the feed. The server may not allow downloads from other websites (CORS). " +
  'Download the zip yourself and upload it instead.';

export interface FeedServiceDeps {
  readonly fetch: (url: string) => Promise<Response>;
  readonly now: () => Date;
  readonly estimate: () => Promise<StorageEstimate>;
}

interface Acquired {
  readonly ok: true;
  readonly stream: ReadableStream<Uint8Array>;
  readonly bytesTotal: number | null;
  readonly id: string;
  readonly sourceKind: FeedSourceKind;
  readonly sourceRef: string;
  readonly fixedName: string | null;
  readonly fallbackName: string;
  readonly catalogSha256: string | null;
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug.length === 0 ? 'feed' : slug;
}

function failure(code: ImportErrorCode, message: string): ImportFailure {
  return {ok: false, code, message, issues: []};
}

function toFailure(error: unknown): ImportFailure {
  if (error instanceof NotZipError) {
    return failure('not_zip', "This file isn't a zip archive. GTFS feeds are distributed as .zip files.");
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/QuotaExceeded|SQLITE_FULL|disk is full|quota/i.test(message)) {
    return failure('quota', 'Ran out of browser storage while importing. Delete other feeds and try again.');
  }
  return failure('unknown', message);
}

function toRecord(row: Record<string, unknown>): FeedRecord {
  const text = (key: string): string | null => {
    const value = row[key];
    return typeof value === 'string' ? value : null;
  };
  const kind = text('source_kind');
  return {
    id: text('id') ?? '',
    name: text('name') ?? '',
    sourceKind: kind === 'catalog' || kind === 'url' ? kind : 'file',
    sourceRef: text('source_ref') ?? '',
    catalogSha256: text('catalog_sha256'),
    importedAt: text('imported_at') ?? '',
    serviceStart: text('service_start'),
    serviceEnd: text('service_end'),
    dbFilename: text('db_filename') ?? '',
  };
}

export class FeedService {
  private readonly store: FeedStore;
  private readonly deps: FeedServiceDeps;
  private meta: Database | null = null;
  private current: {readonly id: string; readonly filename: string; readonly db: Database} | null = null;

  constructor(store: FeedStore, deps: FeedServiceDeps) {
    this.store = store;
    this.deps = deps;
  }

  init(): void {
    const meta = this.store.open(META_FILENAME);
    meta.exec(`
      CREATE TABLE IF NOT EXISTS feeds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        catalog_sha256 TEXT,
        imported_at TEXT NOT NULL,
        service_start TEXT,
        service_end TEXT,
        db_filename TEXT NOT NULL
      )
    `);
    this.meta = meta;
    const referenced = new Set(this.listFeeds().map((feed) => feed.dbFilename));
    for (const name of this.store.list()) {
      if (name.startsWith(FEED_PREFIX) && name.endsWith('.db') && !referenced.has(name)) {
        this.store.remove(name);
      }
    }
  }

  listFeeds(): FeedRecord[] {
    return this.requireMeta().selectObjects('SELECT * FROM feeds ORDER BY name COLLATE NOCASE').map(toRecord);
  }

  openFeed(id: string): FeedRecord | null {
    const record = this.getRecord(id);
    if (record === null) return null;
    this.dbFor(id);
    return record;
  }

  deleteFeed(id: string): void {
    const record = this.getRecord(id);
    if (record === null) return;
    if (this.current?.id === id) this.closeCurrent();
    this.requireMeta().exec({sql: 'DELETE FROM feeds WHERE id = ?', bind: [id]});
    this.store.remove(record.dbFilename);
  }

  async checkStorage(bytes: number): Promise<StorageCheck> {
    const {quota, usage} = await this.deps.estimate();
    if (quota === undefined || usage === undefined) return {ok: true, availableBytes: null};
    const availableBytes = quota - usage;
    return {ok: availableBytes >= bytes * STORAGE_HEADROOM, availableBytes};
  }

  async importFeed(source: ImportSource, onProgress: (p: ImportProgress) => void): Promise<ImportResult> {
    const acquired = await this.acquire(source);
    if (!acquired.ok) return acquired;
    const filename = `${FEED_PREFIX}${acquired.id}-${this.deps.now().getTime()}.db`;
    try {
      await this.store.prepareForNewDb();
      const db = this.store.open(filename);
      db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;');
      createGtfsTables(db);
      const issues = new IssueCollector(db);
      const loaded = await loadGtfsZip(db, acquired.stream, issues, {
        onProgress,
        bytesTotal: acquired.bytesTotal,
      });
      if (loaded.fatal) {
        const fatal = issues.fatalIssues();
        this.store.remove(filename);
        return {
          ok: false,
          code: 'fatal_issues',
          message: fatal.map((issue) => issue.message).join('\n'),
          issues: fatal,
        };
      }
      onProgress({stage: 'derive'});
      buildDerivedTables(db, issues);
      issues.finish();
      db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
      onProgress({stage: 'register'});
      const summary = queries.getFeedSummary(db);
      this.store.close(filename);
      const record: FeedRecord = {
        id: acquired.id,
        name: acquired.fixedName ?? this.nameFromSummary(summary) ?? acquired.fallbackName,
        sourceKind: acquired.sourceKind,
        sourceRef: acquired.sourceRef,
        catalogSha256: acquired.catalogSha256,
        importedAt: this.deps.now().toISOString(),
        serviceStart: summary.serviceStart,
        serviceEnd: summary.serviceEnd,
        dbFilename: filename,
      };
      this.register(record);
      return {ok: true, feed: record, issueCount: issues.totalCount()};
    } catch (error) {
      this.store.remove(filename);
      return toFailure(error);
    }
  }

  getFeedSummary(feedId: string): FeedSummary {
    return queries.getFeedSummary(this.dbFor(feedId));
  }

  getRoutes(feedId: string): RouteSummary[] {
    return queries.getRoutes(this.dbFor(feedId));
  }

  getRouteShapesGeoJSON(feedId: string): FeatureCollection<LineString, RouteShapeProps> {
    return queries.getRouteShapesGeoJSON(this.dbFor(feedId));
  }

  getStopsGeoJSON(feedId: string): FeatureCollection<Point, StopProps> {
    return queries.getStopsGeoJSON(this.dbFor(feedId));
  }

  getRouteDetail(feedId: string, routeId: string): RouteDetail | null {
    return queries.getRouteDetail(this.dbFor(feedId), routeId);
  }

  getStopDetail(feedId: string, stopId: string): StopDetail | null {
    return queries.getStopDetail(this.dbFor(feedId), stopId);
  }

  getStopDepartures(feedId: string, stopId: string, serviceDate: string): Departure[] {
    return queries.getStopDepartures(this.dbFor(feedId), stopId, serviceDate);
  }

  private async acquire(source: ImportSource): Promise<Acquired | ImportFailure> {
    if (source.kind === 'file') {
      const base = source.file.name.replace(/\.zip$/i, '');
      return {
        ok: true,
        stream: source.file.stream(),
        bytesTotal: source.file.size,
        id: slugify(base),
        sourceKind: 'file',
        sourceRef: source.file.name,
        fixedName: null,
        fallbackName: base,
        catalogSha256: null,
      };
    }
    let response: Response;
    try {
      response = await this.deps.fetch(source.url);
    } catch {
      return failure('network', CORS_MESSAGE);
    }
    if (!response.ok || response.body === null) {
      return failure('http', `The server responded with HTTP ${response.status}.`);
    }
    const length = Number(response.headers.get('content-length'));
    const bytesTotal = Number.isFinite(length) && length > 0 ? length : null;
    if (source.kind === 'catalog') {
      return {
        ok: true,
        stream: response.body,
        bytesTotal,
        id: source.id,
        sourceKind: 'catalog',
        sourceRef: source.id,
        fixedName: source.name,
        fallbackName: source.name,
        catalogSha256: source.sha256,
      };
    }
    const url = new URL(source.url);
    return {
      ok: true,
      stream: response.body,
      bytesTotal,
      id: slugify(`${url.hostname}${url.pathname}`),
      sourceKind: 'url',
      sourceRef: source.url,
      fixedName: null,
      fallbackName: url.hostname,
      catalogSha256: null,
    };
  }

  private nameFromSummary(summary: FeedSummary): string | null {
    const names = summary.agencies.map((a) => a.name).filter((n) => n.length > 0);
    const first = names[0];
    if (first !== undefined) {
      return names.length === 1 ? first : `${first} + ${names.length - 1} more`;
    }
    return summary.feedInfo?.publisherName ?? null;
  }

  private register(record: FeedRecord): void {
    const previous = this.getRecord(record.id);
    this.requireMeta().exec({
      sql: `INSERT OR REPLACE INTO feeds
        (id, name, source_kind, source_ref, catalog_sha256, imported_at, service_start, service_end, db_filename)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [
        record.id,
        record.name,
        record.sourceKind,
        record.sourceRef,
        record.catalogSha256,
        record.importedAt,
        record.serviceStart,
        record.serviceEnd,
        record.dbFilename,
      ],
    });
    if (previous !== null && previous.dbFilename !== record.dbFilename) {
      if (this.current?.id === record.id) this.closeCurrent();
      this.store.remove(previous.dbFilename);
    }
  }

  private getRecord(id: string): FeedRecord | null {
    const row = this.requireMeta().selectObject('SELECT * FROM feeds WHERE id = ?', [id]);
    return row === undefined ? null : toRecord(row);
  }

  private dbFor(id: string): Database {
    if (this.current?.id === id) return this.current.db;
    const record = this.getRecord(id);
    if (record === null) throw new Error(`Feed not found: ${id}`);
    this.closeCurrent();
    const db = this.store.open(record.dbFilename);
    this.current = {id, filename: record.dbFilename, db};
    return db;
  }

  private closeCurrent(): void {
    if (this.current === null) return;
    this.store.close(this.current.filename);
    this.current = null;
  }

  private requireMeta(): Database {
    if (this.meta === null) throw new Error('FeedService.init() has not been called');
    return this.meta;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc -b`
Expected: no errors.

```bash
git add src/shared/types.ts src/worker/feed-store.ts src/worker/feed-service.ts src/worker/feed-service_test.ts
git commit -m "feat: add feed service for import, registry, and queries"
```

---
### Task 9: OPFS store, worker entry, and worker host (locks + crash restart)

**Files:**
- Create: `src/worker/sahpool-store.ts`, `src/worker/worker.ts`, `src/db-client/worker-host.ts`, `src/db-client/support.ts`, `src/db-client/feed-api.ts`, `src/db-client/host.ts`
- Test: `src/db-client/worker-host_test.ts`

**Interfaces:**
- Consumes: `FeedService`, `FeedStore` (Task 8), `loadSqlite` (Task 4).
- Produces:

```ts
// src/worker/sahpool-store.ts
export function createSahPoolStore(sqlite3: Sqlite3Static): Promise<FeedStore>;

// src/worker/worker.ts
export type WorkerApi = {start(): Promise<FeedService & ProxyMarked>};

// src/db-client/feed-api.ts
export type FeedApi = Remote<FeedService>;     // every FeedService method, returning a Promise

// src/db-client/worker-host.ts
export const LOCK_NAME = 'gtfs-visualizer-db';
export interface LockLike {
  request(name: string, options: {ifAvailable?: boolean; steal?: boolean}, callback: (lock: unknown) => Promise<void>): Promise<unknown>;
}
export interface WorkerLike { addEventListener(type: 'error', listener: () => void): void; terminate(): void }
export interface HostDeps<W extends WorkerLike, S> {
  readonly locks: LockLike; readonly isSupported: () => boolean;
  readonly createWorker: () => W; readonly connect: (worker: W) => Promise<S>;
}
export type HostState<S> =
  | {readonly kind: 'starting'} | {readonly kind: 'ready'; readonly service: S}
  | {readonly kind: 'other-tab'} | {readonly kind: 'taken-over'}
  | {readonly kind: 'unsupported'; readonly reason: string} | {readonly kind: 'crashed'; readonly message: string};
export class WorkerHost<W extends WorkerLike, S> {
  constructor(deps: HostDeps<W, S>);
  readonly getState: () => HostState<S>;
  readonly subscribe: (listener: () => void) => () => void;
  start(): Promise<void>;      // idempotent
  takeOver(): Promise<void>;   // steals the lock from another tab
}

// src/db-client/support.ts
export function isBrowserSupported(): boolean;

// src/db-client/host.ts
export const host: WorkerHost<Worker, FeedApi>;
```

Behavior: the host holds an exclusive Web Lock for as long as the worker runs. If another tab holds it, state is `other-tab`. `takeOver()` steals it; the tab that lost it terminates its worker (releasing OPFS handles) and shows `taken-over`. A worker `error` event or failed connect triggers one restart; a second failure shows `crashed`. A connect error whose message starts with `unsupported:` shows `unsupported`.

- [ ] **Step 1: Write the failing tests**

`src/db-client/worker-host_test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {WorkerHost, type LockLike, type WorkerLike} from './worker-host.ts';

class FakeWorker implements WorkerLike {
  private readonly listeners: Array<() => void> = [];
  terminated = false;

  addEventListener(_type: 'error', listener: () => void): void {
    this.listeners.push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  crash(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Single-name lock manager with ifAvailable/steal semantics, shared between "tabs". */
class FakeLocks implements LockLike {
  private holder: {reject: (error: unknown) => void} | null = null;

  async request(
    _name: string,
    options: {ifAvailable?: boolean; steal?: boolean},
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown> {
    if (this.holder !== null) {
      if (options.steal === true) {
        this.holder.reject(new DOMException('Lock stolen', 'AbortError'));
        this.holder = null;
      } else if (options.ifAvailable === true) {
        await callback(null);
        return undefined;
      }
    }
    return new Promise((resolve, reject) => {
      this.holder = {reject};
      callback({}).then(resolve, reject);
    });
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeHost(
  locks: FakeLocks,
  options: {supported?: boolean; connectError?: string} = {},
): {host: WorkerHost<FakeWorker, string>; workers: FakeWorker[]} {
  const workers: FakeWorker[] = [];
  const host = new WorkerHost<FakeWorker, string>({
    locks,
    isSupported: () => options.supported ?? true,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    connect: async () => {
      if (options.connectError !== undefined) throw new Error(options.connectError);
      return `svc-${workers.length}`;
    },
  });
  return {host, workers};
}

describe('WorkerHost', () => {
  it('becomes ready after acquiring the lock', async () => {
    const {host} = makeHost(new FakeLocks());
    await host.start();
    expect(host.getState()).toEqual({kind: 'ready', service: 'svc-1'});
  });

  it('ignores repeated start calls', async () => {
    const {host, workers} = makeHost(new FakeLocks());
    await Promise.all([host.start(), host.start()]);
    expect(workers).toHaveLength(1);
    expect(host.getState().kind).toBe('ready');
  });

  it('reports another tab holding the lock, and can take over', async () => {
    const locks = new FakeLocks();
    const first = makeHost(locks);
    const second = makeHost(locks);
    await first.host.start();
    await second.host.start();
    expect(second.host.getState()).toEqual({kind: 'other-tab'});

    await second.host.takeOver();
    await flush();
    expect(second.host.getState()).toEqual({kind: 'ready', service: 'svc-1'});
    expect(first.host.getState()).toEqual({kind: 'taken-over'});
    expect(first.workers[0]?.terminated).toBe(true);
  });

  it('notifies subscribers on state changes', async () => {
    const {host} = makeHost(new FakeLocks());
    const seen: string[] = [];
    host.subscribe(() => seen.push(host.getState().kind));
    await host.start();
    expect(seen).toEqual(['ready']);
  });

  it('reports unsupported browsers without creating a worker', async () => {
    const {host, workers} = makeHost(new FakeLocks(), {supported: false});
    await host.start();
    expect(host.getState().kind).toBe('unsupported');
    expect(workers).toHaveLength(0);
  });

  it('reports unsupported when the worker says so', async () => {
    const {host} = makeHost(new FakeLocks(), {connectError: 'unsupported: no OPFS'});
    await host.start();
    expect(host.getState()).toEqual({kind: 'unsupported', reason: 'no OPFS'});
  });

  it('restarts once after a crash, then gives up', async () => {
    const {host, workers} = makeHost(new FakeLocks());
    await host.start();
    workers[0]?.crash();
    await flush();
    expect(host.getState()).toEqual({kind: 'ready', service: 'svc-2'});
    expect(workers[0]?.terminated).toBe(true);
    workers[1]?.crash();
    await flush();
    expect(host.getState().kind).toBe('crashed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db-client`
Expected: FAIL — cannot resolve `./worker-host.ts`.

- [ ] **Step 3: Implement `src/db-client/worker-host.ts`**

```ts
export const LOCK_NAME = 'gtfs-visualizer-db';

export interface LockLike {
  request(
    name: string,
    options: {ifAvailable?: boolean; steal?: boolean},
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

export interface WorkerLike {
  addEventListener(type: 'error', listener: () => void): void;
  terminate(): void;
}

export interface HostDeps<W extends WorkerLike, S> {
  readonly locks: LockLike;
  readonly isSupported: () => boolean;
  readonly createWorker: () => W;
  readonly connect: (worker: W) => Promise<S>;
}

export type HostState<S> =
  | {readonly kind: 'starting'}
  | {readonly kind: 'ready'; readonly service: S}
  | {readonly kind: 'other-tab'}
  | {readonly kind: 'taken-over'}
  | {readonly kind: 'unsupported'; readonly reason: string}
  | {readonly kind: 'crashed'; readonly message: string};

const UNSUPPORTED_PREFIX = 'unsupported:';
const MAX_RESTARTS = 1;

/** Owns the data worker: one tab at a time (Web Lock), one automatic restart on crash. */
export class WorkerHost<W extends WorkerLike, S> {
  private readonly deps: HostDeps<W, S>;
  private readonly listeners = new Set<() => void>();
  private state: HostState<S> = {kind: 'starting'};
  private worker: W | null = null;
  private restarts = 0;
  private started = false;

  constructor(deps: HostDeps<W, S>) {
    this.deps = deps;
  }

  readonly getState = (): HostState<S> => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.deps.isSupported()) {
      this.setState({
        kind: 'unsupported',
        reason: 'This browser lacks the storage features this app needs.',
      });
      return;
    }
    await this.acquire(false);
  }

  async takeOver(): Promise<void> {
    this.started = true;
    this.restarts = 0;
    await this.acquire(true);
  }

  private acquire(steal: boolean): Promise<void> {
    return new Promise((resolve) => {
      const options = steal ? {steal: true} : {ifAvailable: true};
      this.deps.locks
        .request(LOCK_NAME, options, async (lock) => {
          if (lock === null) {
            this.setState({kind: 'other-tab'});
            resolve();
            return;
          }
          await this.launch();
          resolve();
          // Hold the lock for the life of this tab.
          await new Promise<never>(() => {});
        })
        .catch(() => {
          // Another tab stole the lock.
          this.terminate();
          this.setState({kind: 'taken-over'});
          resolve();
        });
    });
  }

  private async launch(): Promise<void> {
    this.terminate();
    const worker = this.deps.createWorker();
    this.worker = worker;
    worker.addEventListener('error', () => {
      if (this.worker === worker) void this.handleCrash('The data worker stopped unexpectedly.');
    });
    try {
      const service = await this.deps.connect(worker);
      if (this.worker === worker) this.setState({kind: 'ready', service});
    } catch (error) {
      if (this.worker !== worker) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(UNSUPPORTED_PREFIX)) {
        this.terminate();
        this.setState({kind: 'unsupported', reason: message.slice(UNSUPPORTED_PREFIX.length).trim()});
        return;
      }
      await this.handleCrash(message);
    }
  }

  private async handleCrash(message: string): Promise<void> {
    if (this.restarts >= MAX_RESTARTS) {
      this.terminate();
      this.setState({kind: 'crashed', message});
      return;
    }
    this.restarts++;
    await this.launch();
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private setState(state: HostState<S>): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db-client`
Expected: PASS.

- [ ] **Step 5: Implement the OPFS store, worker entry, and app host**

`src/worker/sahpool-store.ts`:

```ts
import type {SAHPoolUtil, Sqlite3Static} from '@sqlite.org/sqlite-wasm';
import type {FeedStore} from './feed-store.ts';
import type {Database} from './sqlite.ts';

const POOL_NAME = 'gtfs-visualizer';
const INITIAL_CAPACITY = 8;
/** A database plus its journal and temp files. */
const SLOTS_PER_NEW_DB = 4;
/** After another tab hands over, its worker may take a moment to release OPFS handles. */
const INSTALL_ATTEMPTS = 10;
const INSTALL_RETRY_MS = 500;

class SahPoolFeedStore implements FeedStore {
  private readonly pool: SAHPoolUtil;
  private readonly handles = new Map<string, Database>();

  constructor(pool: SAHPoolUtil) {
    this.pool = pool;
  }

  open(filename: string): Database {
    let db = this.handles.get(filename);
    if (db === undefined) {
      db = new this.pool.OpfsSAHPoolDb(filename);
      this.handles.set(filename, db);
    }
    return db;
  }

  close(filename: string): void {
    this.handles.get(filename)?.close();
    this.handles.delete(filename);
  }

  remove(filename: string): void {
    this.close(filename);
    this.pool.unlink(filename);
  }

  list(): string[] {
    return this.pool.getFileNames().filter((name) => name.endsWith('.db'));
  }

  async prepareForNewDb(): Promise<void> {
    await this.pool.reserveMinimumCapacity(Number(this.pool.getFileCount()) + SLOTS_PER_NEW_DB);
  }
}

export async function createSahPoolStore(sqlite3: Sqlite3Static): Promise<FeedStore> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < INSTALL_ATTEMPTS; attempt++) {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({
        name: POOL_NAME,
        initialCapacity: INITIAL_CAPACITY,
      });
      return new SahPoolFeedStore(pool);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, INSTALL_RETRY_MS));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
```

`src/worker/worker.ts`:

```ts
import * as Comlink from 'comlink';
import {FeedService} from './feed-service.ts';
import {createSahPoolStore} from './sahpool-store.ts';
import {loadSqlite} from './sqlite.ts';

function hasSyncAccessHandles(): boolean {
  return (
    typeof FileSystemFileHandle !== 'undefined' &&
    'createSyncAccessHandle' in FileSystemFileHandle.prototype
  );
}

async function start(): Promise<FeedService & Comlink.ProxyMarked> {
  if (typeof navigator.storage?.getDirectory !== 'function' || !hasSyncAccessHandles()) {
    throw new Error('unsupported: this browser has no Origin Private File System support in workers.');
  }
  const sqlite3 = await loadSqlite();
  const store = await createSahPoolStore(sqlite3);
  const service = new FeedService(store, {
    fetch: (url) => fetch(url),
    now: () => new Date(),
    estimate: () => navigator.storage.estimate(),
  });
  service.init();
  return Comlink.proxy(service);
}

const workerApi = {start};

export type WorkerApi = typeof workerApi;

Comlink.expose(workerApi);
```

`src/db-client/feed-api.ts`:

```ts
import type {Remote} from 'comlink';
import type {FeedService} from '../worker/feed-service.ts';

/** The worker's FeedService as seen from the main thread: every method returns a Promise. */
export type FeedApi = Remote<FeedService>;
```

`src/db-client/support.ts`:

```ts
export function isBrowserSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof navigator.locks?.request === 'function'
  );
}
```

`src/db-client/host.ts`:

```ts
import * as Comlink from 'comlink';
import type {WorkerApi} from '../worker/worker.ts';
import type {FeedApi} from './feed-api.ts';
import {isBrowserSupported} from './support.ts';
import {WorkerHost} from './worker-host.ts';

export const host = new WorkerHost<Worker, FeedApi>({
  // Wrapped so the call matches LockLike exactly rather than LockManager's overloads.
  locks: {
    request: (name, options, callback) => navigator.locks.request(name, options, callback),
  },
  isSupported: isBrowserSupported,
  createWorker: () =>
    new Worker(new URL('../worker/worker.ts', import.meta.url), {type: 'module'}),
  connect: async (worker) => {
    const api = Comlink.wrap<WorkerApi>(worker);
    return await api.start();
  },
});
```

- [ ] **Step 6: Type-check, test, and commit**

Run: `npx tsc -b && npx vitest run`
Expected: no type errors; all tests PASS. (This code runs in the browser for the first time in Task 13/14.)

```bash
git add src/worker/sahpool-store.ts src/worker/worker.ts src/db-client
git commit -m "feat: run the feed service in an OPFS worker with tab locking and restart"
```

---

### Task 10: Catalog client and URL selection state

**Files:**
- Create: `src/catalog/catalog-types.ts`, `src/catalog/catalog.ts`, `src/state/url-state.ts`
- Test: `src/catalog/catalog_test.ts`, `src/state/url-state_test.ts`

**Interfaces:**
- Consumes: `FeedRecord` (Task 8), `fromIsoDate`/`toIsoDate` (Task 1).
- Produces:

```ts
// src/catalog/catalog-types.ts  (also used by the Node mirror script)
export interface CatalogEntry { readonly id: string; readonly name: string; readonly region: string; readonly sourceUrl: string }
export interface CatalogLockEntry {
  readonly sha256: string | null; readonly size: number | null; readonly fetchedAt: string | null;
  readonly lastError: string | null; readonly lastErrorAt: string | null;
}
export interface CatalogLock { readonly generatedAt: string; readonly feeds: Readonly<Record<string, CatalogLockEntry>> }
export const CATALOG_FILE = 'catalog.json';
export const LOCK_FILE = 'catalog.lock.json';
export function feedZipKey(id: string): string;           // 'feeds/<id>.zip'
export function parseCatalog(json: unknown): CatalogEntry[];   // throws on invalid
export function parseLock(json: unknown): CatalogLock;         // lenient: bad input -> empty lock

// src/catalog/catalog.ts
export interface CatalogFeed extends CatalogEntry {
  readonly zipUrl: string; readonly sha256: string | null; readonly size: number | null;
  readonly fetchedAt: string | null; readonly available: boolean;
}
export function fetchCatalog(baseUrl: string, fetchFn?: (url: string) => Promise<Response>): Promise<CatalogFeed[]>;
export function isUpdateAvailable(feed: CatalogFeed, record: FeedRecord | undefined): boolean;

// src/state/url-state.ts
export interface Selection { readonly feed: string | null; readonly route: string | null; readonly stop: string | null; readonly date: string | null }  // date is YYYYMMDD
export const EMPTY_SELECTION: Selection;
export function parseSelection(search: string): Selection;
export function serializeSelection(selection: Selection): string;    // '' or '?feed=...&route=...&stop=...&date=YYYY-MM-DD'
export function applyPatch(current: Selection, patch: Partial<Selection>): Selection;
export type UpdateSelection = (patch: Partial<Selection>, options?: {readonly replace?: boolean}) => void;
export function useSelection(): [Selection, UpdateSelection];
```

`applyPatch`: switching to a different feed clears `route`, `stop`, and `date` unless the patch sets them.

- [ ] **Step 1: Write the failing tests**

`src/catalog/catalog_test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import type {FeedRecord} from '../shared/types.ts';
import {fetchCatalog, isUpdateAvailable, type CatalogFeed} from './catalog.ts';
import {parseCatalog} from './catalog-types.ts';

const CATALOG = [
  {id: 'mbta', name: 'MBTA', region: 'Boston', sourceUrl: 'https://cdn.mbta.com/MBTA_GTFS.zip'},
  {id: 'new-feed', name: 'New Feed', region: 'Nowhere', sourceUrl: 'https://x.test/gtfs.zip'},
];
const LOCK = {
  generatedAt: '2026-10-09T09:17:00Z',
  feeds: {
    mbta: {sha256: 'aaa', size: 100, fetchedAt: '2026-10-09T09:17:00Z', lastError: null, lastErrorAt: null},
  },
};

function fakeFetch(responses: Record<string, unknown>): (url: string) => Promise<Response> {
  return async (url) => {
    const body = responses[url];
    return body === undefined ? new Response('missing', {status: 404}) : Response.json(body);
  };
}

const RECORD: FeedRecord = {
  id: 'mbta',
  name: 'MBTA',
  sourceKind: 'catalog',
  sourceRef: 'mbta',
  catalogSha256: 'aaa',
  importedAt: '2026-10-01T00:00:00Z',
  serviceStart: null,
  serviceEnd: null,
  dbFilename: '/feeds/mbta-1.db',
};

describe('fetchCatalog', () => {
  it('merges the catalog with the lock file', async () => {
    const feeds = await fetchCatalog(
      'https://r2.test/',
      fakeFetch({'https://r2.test/catalog.json': CATALOG, 'https://r2.test/catalog.lock.json': LOCK}),
    );
    expect(feeds).toEqual([
      {...CATALOG[0], zipUrl: 'https://r2.test/feeds/mbta.zip', sha256: 'aaa', size: 100, fetchedAt: '2026-10-09T09:17:00Z', available: true},
      {...CATALOG[1], zipUrl: 'https://r2.test/feeds/new-feed.zip', sha256: null, size: null, fetchedAt: null, available: false},
    ]);
  });

  it('treats a missing lock file as nothing mirrored yet', async () => {
    const feeds = await fetchCatalog('https://r2.test', fakeFetch({'https://r2.test/catalog.json': CATALOG}));
    expect(feeds.every((f) => !f.available)).toBe(true);
  });

  it('throws when the catalog itself is unavailable', async () => {
    await expect(fetchCatalog('https://r2.test', fakeFetch({}))).rejects.toThrow('HTTP 404');
  });
});

describe('isUpdateAvailable', () => {
  const feed: CatalogFeed = {
    ...CATALOG[0],
    id: 'mbta',
    name: 'MBTA',
    region: 'Boston',
    sourceUrl: 'https://cdn.mbta.com/MBTA_GTFS.zip',
    zipUrl: 'https://r2.test/feeds/mbta.zip',
    sha256: 'bbb',
    size: 100,
    fetchedAt: null,
    available: true,
  };
  it('is true when the mirrored zip differs from the imported one', () => {
    expect(isUpdateAvailable(feed, RECORD)).toBe(true);
  });
  it('is false when checksums match or the feed is not imported from the catalog', () => {
    expect(isUpdateAvailable({...feed, sha256: 'aaa'}, RECORD)).toBe(false);
    expect(isUpdateAvailable(feed, undefined)).toBe(false);
    expect(isUpdateAvailable(feed, {...RECORD, sourceKind: 'url'})).toBe(false);
  });
});

describe('parseCatalog', () => {
  it('rejects invalid or duplicate ids', () => {
    expect(() => parseCatalog([{...CATALOG[0], id: 'Bad Id'}])).toThrow(/id/);
    expect(() => parseCatalog([CATALOG[0], CATALOG[0]])).toThrow(/duplicate/i);
    expect(() => parseCatalog({})).toThrow(/array/);
  });
});
```

`src/state/url-state_test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {applyPatch, EMPTY_SELECTION, parseSelection, serializeSelection} from './url-state.ts';

describe('url state', () => {
  it('parses and serializes selections', () => {
    const selection = parseSelection('?feed=demo&route=R10&stop=STN&date=2026-10-12');
    expect(selection).toEqual({feed: 'demo', route: 'R10', stop: 'STN', date: '20261012'});
    expect(serializeSelection(selection)).toBe('?feed=demo&route=R10&stop=STN&date=2026-10-12');
  });

  it('drops empty and invalid values', () => {
    expect(parseSelection('?feed=&date=2026-02-30')).toEqual(EMPTY_SELECTION);
    expect(serializeSelection(EMPTY_SELECTION)).toBe('');
  });

  it('round-trips ids that need escaping', () => {
    const selection = {...EMPTY_SELECTION, feed: 'a b', stop: 'x&y=z'};
    expect(parseSelection(serializeSelection(selection))).toEqual(selection);
  });

  it('clears route, stop, and date when switching feeds', () => {
    const current = {feed: 'a', route: 'R', stop: 'S', date: '20261012'};
    expect(applyPatch(current, {feed: 'b'})).toEqual({feed: 'b', route: null, stop: null, date: null});
    expect(applyPatch(current, {feed: 'b', route: 'R2'})).toEqual({feed: 'b', route: 'R2', stop: null, date: null});
    expect(applyPatch(current, {stop: null})).toEqual({...current, stop: null});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/catalog src/state`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/catalog/catalog-types.ts`**

```ts
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly sourceUrl: string;
}

export interface CatalogLockEntry {
  readonly sha256: string | null;
  readonly size: number | null;
  readonly fetchedAt: string | null;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
}

export interface CatalogLock {
  readonly generatedAt: string;
  readonly feeds: Readonly<Record<string, CatalogLockEntry>>;
}

export const CATALOG_FILE = 'catalog.json';
export const LOCK_FILE = 'catalog.lock.json';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function feedZipKey(id: string): string {
  return `feeds/${id}.zip`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(entry: Record<string, unknown>, key: string, index: number): string {
  const value = entry[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Catalog entry ${index} needs a non-empty string "${key}".`);
  }
  return value;
}

export function parseCatalog(json: unknown): CatalogEntry[] {
  if (!Array.isArray(json)) throw new Error('The catalog must be a JSON array.');
  const seen = new Set<string>();
  return json.map((item: unknown, index) => {
    if (!isRecord(item)) throw new Error(`Catalog entry ${index} must be an object.`);
    const id = requireString(item, 'id', index);
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Catalog entry ${index} has an invalid id "${id}" (use lowercase letters, digits, and dashes).`);
    }
    if (seen.has(id)) throw new Error(`Duplicate catalog id "${id}".`);
    seen.add(id);
    return {
      id,
      name: requireString(item, 'name', index),
      region: requireString(item, 'region', index),
      sourceUrl: requireString(item, 'sourceUrl', index),
    };
  });
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function parseLock(json: unknown): CatalogLock {
  if (!isRecord(json) || !isRecord(json['feeds'])) return {generatedAt: '', feeds: {}};
  const feeds: Record<string, CatalogLockEntry> = {};
  for (const [id, value] of Object.entries(json['feeds'])) {
    if (!isRecord(value)) continue;
    feeds[id] = {
      sha256: optionalString(value['sha256']),
      size: typeof value['size'] === 'number' ? value['size'] : null,
      fetchedAt: optionalString(value['fetchedAt']),
      lastError: optionalString(value['lastError']),
      lastErrorAt: optionalString(value['lastErrorAt']),
    };
  }
  return {generatedAt: optionalString(json['generatedAt']) ?? '', feeds};
}
```

- [ ] **Step 4: Implement `src/catalog/catalog.ts`**

```ts
import type {FeedRecord} from '../shared/types.ts';
import {
  CATALOG_FILE,
  feedZipKey,
  LOCK_FILE,
  parseCatalog,
  parseLock,
  type CatalogEntry,
} from './catalog-types.ts';

export interface CatalogFeed extends CatalogEntry {
  readonly zipUrl: string;
  readonly sha256: string | null;
  readonly size: number | null;
  readonly fetchedAt: string | null;
  readonly available: boolean;
}

async function getJson(fetchFn: (url: string) => Promise<Response>, url: string): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.json();
}

export async function fetchCatalog(
  baseUrl: string,
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url, {cache: 'no-cache'}),
): Promise<CatalogFeed[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const catalog = parseCatalog(await getJson(fetchFn, `${base}/${CATALOG_FILE}`));
  let lockJson: unknown = null;
  try {
    lockJson = await getJson(fetchFn, `${base}/${LOCK_FILE}`);
  } catch {
    // Not mirrored yet: every entry shows as unavailable.
  }
  const lock = parseLock(lockJson);
  return catalog.map((entry) => {
    const mirrored = lock.feeds[entry.id];
    const sha256 = mirrored?.sha256 ?? null;
    return {
      ...entry,
      zipUrl: `${base}/${feedZipKey(entry.id)}`,
      sha256,
      size: mirrored?.size ?? null,
      fetchedAt: mirrored?.fetchedAt ?? null,
      available: sha256 !== null,
    };
  });
}

export function isUpdateAvailable(feed: CatalogFeed, record: FeedRecord | undefined): boolean {
  return (
    record !== undefined &&
    record.sourceKind === 'catalog' &&
    feed.sha256 !== null &&
    record.catalogSha256 !== feed.sha256
  );
}
```

- [ ] **Step 5: Implement `src/state/url-state.ts`**

```ts
import {useCallback, useMemo, useSyncExternalStore} from 'react';
import {fromIsoDate, toIsoDate} from '../gtfs/time.ts';

export interface Selection {
  readonly feed: string | null;
  readonly route: string | null;
  readonly stop: string | null;
  /** Service date as YYYYMMDD. */
  readonly date: string | null;
}

export const EMPTY_SELECTION: Selection = {feed: null, route: null, stop: null, date: null};

const CHANGE_EVENT = 'gtfs:selectionchange';

function param(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value === null || value.length === 0 ? null : value;
}

export function parseSelection(search: string): Selection {
  const params = new URLSearchParams(search);
  const isoDate = param(params, 'date');
  return {
    feed: param(params, 'feed'),
    route: param(params, 'route'),
    stop: param(params, 'stop'),
    date: isoDate === null ? null : fromIsoDate(isoDate),
  };
}

export function serializeSelection(selection: Selection): string {
  const params = new URLSearchParams();
  if (selection.feed !== null) params.set('feed', selection.feed);
  if (selection.route !== null) params.set('route', selection.route);
  if (selection.stop !== null) params.set('stop', selection.stop);
  if (selection.date !== null) params.set('date', toIsoDate(selection.date));
  const query = params.toString();
  return query.length === 0 ? '' : `?${query}`;
}

export function applyPatch(current: Selection, patch: Partial<Selection>): Selection {
  const switchingFeed = patch.feed !== undefined && patch.feed !== current.feed;
  const base = switchingFeed ? {...EMPTY_SELECTION} : current;
  return {...base, ...patch};
}

export type UpdateSelection = (
  patch: Partial<Selection>,
  options?: {readonly replace?: boolean},
) => void;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getSearch(): string {
  return window.location.search;
}

/** The URL query string is the source of truth for what is selected. */
export function useSelection(): [Selection, UpdateSelection] {
  const search = useSyncExternalStore(subscribe, getSearch);
  const selection = useMemo(() => parseSelection(search), [search]);
  const update = useCallback<UpdateSelection>((patch, options = {}) => {
    const next = applyPatch(parseSelection(window.location.search), patch);
    const url = `${window.location.pathname}${serializeSelection(next)}`;
    if (options.replace === true) {
      window.history.replaceState(null, '', url);
    } else {
      window.history.pushState(null, '', url);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [selection, update];
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/catalog src/state`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/catalog src/state
git commit -m "feat: add catalog client and URL-driven selection state"
```

---

### Task 11: Map adapter, layers, Mapbox and fake implementations

**Files:**
- Create: `src/map/adapter.ts`, `src/map/layers.ts`, `src/map/create-map.ts`, `src/map/mapbox-adapter.ts`, `src/map/fake-adapter.ts`
- Test: `src/map/layers_test.ts`

**Interfaces:**
- Produces:

```ts
// src/map/adapter.ts
export type Bounds = readonly [number, number, number, number];   // [minLon, minLat, maxLon, maxLat]
export type PaintValue = string | {readonly property: string};
export type LayerFilter =
  | {readonly kind: 'all'} | {readonly kind: 'none'}
  | {readonly kind: 'eq'; readonly property: string; readonly value: string}
  | {readonly kind: 'in'; readonly property: string; readonly values: readonly string[]};
export interface LineLayerSpec { readonly kind: 'line'; readonly id: string; readonly source: string; readonly minZoom?: number; readonly filter?: LayerFilter;
  readonly paint: {readonly color: PaintValue; readonly width: number; readonly opacity: number} }
export interface CircleLayerSpec { readonly kind: 'circle'; readonly id: string; readonly source: string; readonly minZoom?: number; readonly filter?: LayerFilter;
  readonly paint: {readonly color: PaintValue; readonly radius: number; readonly strokeColor: string; readonly strokeWidth: number} }
export type LayerSpec = LineLayerSpec | CircleLayerSpec;
export interface MapFeature { readonly layerId: string; readonly properties: Readonly<Record<string, unknown>> }
export interface ScreenPoint { readonly x: number; readonly y: number }
export interface MapAdapter {
  setSource(id: string, data: FeatureCollection): void;
  addLayer(spec: LayerSpec): void;
  removeLayer(id: string): void;
  setFilter(layerId: string, filter: LayerFilter): void;
  setOpacity(layerId: string, opacity: number): void;
  fitBounds(bounds: Bounds): void;
  onFeatureClick(layerIds: readonly string[], handler: (feature: MapFeature) => void): () => void;
  onFeatureHover(layerIds: readonly string[], handler: (feature: MapFeature | null, point: ScreenPoint) => void): () => void;
  destroy(): void;
}
export type MapUnavailableReason = 'missing_token' | 'invalid_token';
export class MapUnavailableError extends Error { readonly reason: MapUnavailableReason }
export function matchesFilter(filter: LayerFilter, properties: Readonly<Record<string, unknown>>): boolean;

// src/map/layers.ts
export const SOURCE_ROUTES = 'routes';
export const SOURCE_STOPS = 'stops';
export const LAYER: {readonly routes: 'routes-line'; readonly routeHighlight: 'routes-highlight'; readonly stops: 'stops-circle'; readonly routeStops: 'stops-route'; readonly stopHighlight: 'stop-highlight'};
export const CLICK_LAYERS: readonly string[];      // priority order: stops first, then routes
export const EMPTY_COLLECTION: FeatureCollection;
export function baseLayers(): LayerSpec[];
export interface SelectionStyleInput { readonly routeId: string | null; readonly stopId: string | null; readonly routeStopIds: readonly string[] }
export interface SelectionStyle {
  readonly filters: ReadonlyArray<{readonly layerId: string; readonly filter: LayerFilter}>;
  readonly opacity: ReadonlyArray<{readonly layerId: string; readonly opacity: number}>;
}
export function selectionStyle(input: SelectionStyleInput): SelectionStyle;
export function boundsOf(collection: FeatureCollection, include?: (properties: Readonly<Record<string, unknown>>) => boolean): Bounds | null;

// src/map/create-map.ts
export function createMap(container: HTMLElement): Promise<MapAdapter>;
```

Layer behavior (spec §5): `routes-line` colored by feature `color`; `routes-highlight` shows only the selected route (others dimmed to 0.25 opacity); `stops-circle` from zoom 13; `stops-route` shows the selected route's pattern stops at any zoom; `stop-highlight` marks the selected stop. The fake adapter renders each visible feature of layers without `minZoom` as a `<button data-layer=…>` named by the feature's `name` property, and exposes its filter/opacity state as JSON in `data-state` on `[data-testid="fake-map"]`.

- [ ] **Step 1: Write the failing tests**

`src/map/layers_test.ts`:

```ts
import type {FeatureCollection} from 'geojson';
import {describe, expect, it} from 'vitest';
import {matchesFilter} from './adapter.ts';
import {baseLayers, boundsOf, CLICK_LAYERS, LAYER, selectionStyle} from './layers.ts';

const LINES: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {routeId: 'A'},
      geometry: {type: 'LineString', coordinates: [[-122, 37], [-121, 38]]},
    },
    {
      type: 'Feature',
      properties: {routeId: 'B'},
      geometry: {type: 'LineString', coordinates: [[-120, 36], [-119.5, 36.5]]},
    },
  ],
};

describe('layers', () => {
  it('defines every layer once, and every clickable layer exists', () => {
    const ids = baseLayers().map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of CLICK_LAYERS) expect(ids).toContain(id);
  });

  it('hides highlights and shows full-opacity routes with nothing selected', () => {
    expect(selectionStyle({routeId: null, stopId: null, routeStopIds: []})).toEqual({
      filters: [
        {layerId: LAYER.routeHighlight, filter: {kind: 'none'}},
        {layerId: LAYER.routeStops, filter: {kind: 'none'}},
        {layerId: LAYER.stopHighlight, filter: {kind: 'none'}},
      ],
      opacity: [{layerId: LAYER.routes, opacity: 0.9}],
    });
  });

  it('highlights the selected route, its stops, and the selected stop', () => {
    expect(selectionStyle({routeId: 'A', stopId: 'S2', routeStopIds: ['S1', 'S2']})).toEqual({
      filters: [
        {layerId: LAYER.routeHighlight, filter: {kind: 'eq', property: 'routeId', value: 'A'}},
        {layerId: LAYER.routeStops, filter: {kind: 'in', property: 'stopId', values: ['S1', 'S2']}},
        {layerId: LAYER.stopHighlight, filter: {kind: 'eq', property: 'stopId', value: 'S2'}},
      ],
      opacity: [{layerId: LAYER.routes, opacity: 0.25}],
    });
  });

  it('computes bounds, optionally for a subset', () => {
    expect(boundsOf(LINES)).toEqual([-122, 36, -119.5, 38]);
    expect(boundsOf(LINES, (p) => p['routeId'] === 'B')).toEqual([-120, 36, -119.5, 36.5]);
    expect(boundsOf(LINES, () => false)).toBeNull();
  });

  it('evaluates filters', () => {
    expect(matchesFilter({kind: 'all'}, {})).toBe(true);
    expect(matchesFilter({kind: 'none'}, {})).toBe(false);
    expect(matchesFilter({kind: 'eq', property: 'a', value: 'x'}, {a: 'x'})).toBe(true);
    expect(matchesFilter({kind: 'in', property: 'a', values: ['y']}, {a: 'x'})).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/map`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/map/adapter.ts`**

```ts
import type {FeatureCollection} from 'geojson';

export type Bounds = readonly [number, number, number, number];

export type PaintValue = string | {readonly property: string};

export type LayerFilter =
  | {readonly kind: 'all'}
  | {readonly kind: 'none'}
  | {readonly kind: 'eq'; readonly property: string; readonly value: string}
  | {readonly kind: 'in'; readonly property: string; readonly values: readonly string[]};

interface LayerBase {
  readonly id: string;
  readonly source: string;
  readonly minZoom?: number;
  readonly filter?: LayerFilter;
}

export interface LineLayerSpec extends LayerBase {
  readonly kind: 'line';
  readonly paint: {readonly color: PaintValue; readonly width: number; readonly opacity: number};
}

export interface CircleLayerSpec extends LayerBase {
  readonly kind: 'circle';
  readonly paint: {
    readonly color: PaintValue;
    readonly radius: number;
    readonly strokeColor: string;
    readonly strokeWidth: number;
  };
}

export type LayerSpec = LineLayerSpec | CircleLayerSpec;

export interface MapFeature {
  readonly layerId: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Provider-neutral map surface. Only map implementations import a map library. */
export interface MapAdapter {
  setSource(id: string, data: FeatureCollection): void;
  addLayer(spec: LayerSpec): void;
  removeLayer(id: string): void;
  setFilter(layerId: string, filter: LayerFilter): void;
  setOpacity(layerId: string, opacity: number): void;
  fitBounds(bounds: Bounds): void;
  onFeatureClick(layerIds: readonly string[], handler: (feature: MapFeature) => void): () => void;
  onFeatureHover(
    layerIds: readonly string[],
    handler: (feature: MapFeature | null, point: ScreenPoint) => void,
  ): () => void;
  destroy(): void;
}

export type MapUnavailableReason = 'missing_token' | 'invalid_token';

export class MapUnavailableError extends Error {
  readonly reason: MapUnavailableReason;

  constructor(reason: MapUnavailableReason) {
    super(
      reason === 'missing_token'
        ? 'No Mapbox access token is configured.'
        : 'The Mapbox access token was rejected.',
    );
    this.name = 'MapUnavailableError';
    this.reason = reason;
  }
}

export function matchesFilter(
  filter: LayerFilter,
  properties: Readonly<Record<string, unknown>>,
): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'none':
      return false;
    case 'eq':
      return properties[filter.property] === filter.value;
    case 'in': {
      const value = properties[filter.property];
      return typeof value === 'string' && filter.values.includes(value);
    }
  }
}
```

- [ ] **Step 4: Implement `src/map/layers.ts`**

```ts
import type {FeatureCollection, Position} from 'geojson';
import type {Bounds, LayerFilter, LayerSpec} from './adapter.ts';

export const SOURCE_ROUTES = 'routes';
export const SOURCE_STOPS = 'stops';

export const LAYER = {
  routes: 'routes-line',
  routeHighlight: 'routes-highlight',
  stops: 'stops-circle',
  routeStops: 'stops-route',
  stopHighlight: 'stop-highlight',
} as const;

/** Click priority: the most specific feature under the cursor wins. */
export const CLICK_LAYERS: readonly string[] = [
  LAYER.stopHighlight,
  LAYER.routeStops,
  LAYER.stops,
  LAYER.routeHighlight,
  LAYER.routes,
];

export const EMPTY_COLLECTION: FeatureCollection = {type: 'FeatureCollection', features: []};

const NONE: LayerFilter = {kind: 'none'};
const STOPS_MIN_ZOOM = 13;
const DIMMED_OPACITY = 0.25;
const NORMAL_OPACITY = 0.9;

export function baseLayers(): LayerSpec[] {
  return [
    {
      kind: 'line',
      id: LAYER.routes,
      source: SOURCE_ROUTES,
      paint: {color: {property: 'color'}, width: 2.5, opacity: NORMAL_OPACITY},
    },
    {
      kind: 'line',
      id: LAYER.routeHighlight,
      source: SOURCE_ROUTES,
      filter: NONE,
      paint: {color: {property: 'color'}, width: 6, opacity: 1},
    },
    {
      kind: 'circle',
      id: LAYER.stops,
      source: SOURCE_STOPS,
      minZoom: STOPS_MIN_ZOOM,
      paint: {color: '#ffffff', radius: 3.5, strokeColor: '#334155', strokeWidth: 1},
    },
    {
      kind: 'circle',
      id: LAYER.routeStops,
      source: SOURCE_STOPS,
      filter: NONE,
      paint: {color: '#ffffff', radius: 4.5, strokeColor: '#0f172a', strokeWidth: 1.5},
    },
    {
      kind: 'circle',
      id: LAYER.stopHighlight,
      source: SOURCE_STOPS,
      filter: NONE,
      paint: {color: '#facc15', radius: 8, strokeColor: '#0f172a', strokeWidth: 2},
    },
  ];
}

export interface SelectionStyleInput {
  readonly routeId: string | null;
  readonly stopId: string | null;
  readonly routeStopIds: readonly string[];
}

export interface SelectionStyle {
  readonly filters: ReadonlyArray<{readonly layerId: string; readonly filter: LayerFilter}>;
  readonly opacity: ReadonlyArray<{readonly layerId: string; readonly opacity: number}>;
}

export function selectionStyle(input: SelectionStyleInput): SelectionStyle {
  return {
    filters: [
      {
        layerId: LAYER.routeHighlight,
        filter: input.routeId === null ? NONE : {kind: 'eq', property: 'routeId', value: input.routeId},
      },
      {
        layerId: LAYER.routeStops,
        filter:
          input.routeStopIds.length === 0
            ? NONE
            : {kind: 'in', property: 'stopId', values: input.routeStopIds},
      },
      {
        layerId: LAYER.stopHighlight,
        filter: input.stopId === null ? NONE : {kind: 'eq', property: 'stopId', value: input.stopId},
      },
    ],
    opacity: [{layerId: LAYER.routes, opacity: input.routeId === null ? NORMAL_OPACITY : DIMMED_OPACITY}],
  };
}

export function boundsOf(
  collection: FeatureCollection,
  include: (properties: Readonly<Record<string, unknown>>) => boolean = () => true,
): Bounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const extend = (position: Position): void => {
    const [lon, lat] = position;
    if (lon === undefined || lat === undefined) return;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  };
  for (const feature of collection.features) {
    if (!include(feature.properties ?? {})) continue;
    const geometry = feature.geometry;
    if (geometry.type === 'Point') extend(geometry.coordinates);
    if (geometry.type === 'LineString') geometry.coordinates.forEach(extend);
  }
  return Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/map`
Expected: PASS.

- [ ] **Step 6: Implement the fake adapter**

`src/map/fake-adapter.ts`:

```ts
import type {FeatureCollection} from 'geojson';
import {
  matchesFilter,
  type Bounds,
  type LayerFilter,
  type LayerSpec,
  type MapAdapter,
  type MapFeature,
} from './adapter.ts';

interface FakeState {
  readonly filters: Record<string, LayerFilter>;
  readonly opacity: Record<string, number>;
  fitBoundsCount: number;
  lastBounds: Bounds | null;
}

interface ClickEntry {
  readonly layerIds: readonly string[];
  readonly handler: (feature: MapFeature) => void;
}

/** Renders features as buttons so E2E tests can see and click "map" features without WebGL. */
class FakeMapAdapter implements MapAdapter {
  private readonly root: HTMLElement;
  private readonly sources = new Map<string, FeatureCollection>();
  private readonly layers: LayerSpec[] = [];
  private readonly clickHandlers = new Set<ClickEntry>();
  private readonly state: FakeState = {filters: {}, opacity: {}, fitBoundsCount: 0, lastBounds: null};

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'fake-map';
    this.root.dataset['testid'] = 'fake-map';
    container.append(this.root);
    this.render();
  }

  setSource(id: string, data: FeatureCollection): void {
    this.sources.set(id, data);
    this.render();
  }

  addLayer(spec: LayerSpec): void {
    this.layers.push(spec);
    this.state.filters[spec.id] = spec.filter ?? {kind: 'all'};
    this.render();
  }

  removeLayer(id: string): void {
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index >= 0) this.layers.splice(index, 1);
    delete this.state.filters[id];
    this.render();
  }

  setFilter(layerId: string, filter: LayerFilter): void {
    this.state.filters[layerId] = filter;
    this.render();
  }

  setOpacity(layerId: string, opacity: number): void {
    this.state.opacity[layerId] = opacity;
    this.render();
  }

  fitBounds(bounds: Bounds): void {
    this.state.fitBoundsCount++;
    this.state.lastBounds = bounds;
    this.render();
  }

  onFeatureClick(layerIds: readonly string[], handler: (feature: MapFeature) => void): () => void {
    const entry = {layerIds, handler};
    this.clickHandlers.add(entry);
    return () => {
      this.clickHandlers.delete(entry);
    };
  }

  onFeatureHover(): () => void {
    return () => {};
  }

  destroy(): void {
    this.root.remove();
  }

  private render(): void {
    this.root.dataset['state'] = JSON.stringify(this.state);
    const list = document.createElement('ul');
    for (const layer of this.layers) {
      if (layer.minZoom !== undefined) continue;
      const filter = this.state.filters[layer.id] ?? {kind: 'all'};
      for (const feature of this.sources.get(layer.source)?.features ?? []) {
        const properties: Readonly<Record<string, unknown>> = feature.properties ?? {};
        if (!matchesFilter(filter, properties)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['layer'] = layer.id;
        button.textContent = String(properties['name'] ?? '');
        button.addEventListener('click', () => this.click({layerId: layer.id, properties}));
        const item = document.createElement('li');
        item.append(button);
        list.append(item);
      }
    }
    this.root.replaceChildren(list);
  }

  private click(feature: MapFeature): void {
    for (const {layerIds, handler} of this.clickHandlers) {
      if (layerIds.includes(feature.layerId)) handler(feature);
    }
  }
}

export async function createFakeAdapter(container: HTMLElement): Promise<MapAdapter> {
  return new FakeMapAdapter(container);
}
```

- [ ] **Step 7: Implement the Mapbox adapter and provider selection**

`src/map/mapbox-adapter.ts`:

```ts
import mapboxgl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
  type PointLike,
} from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type {FeatureCollection} from 'geojson';
import {
  MapUnavailableError,
  type Bounds,
  type LayerFilter,
  type LayerSpec,
  type MapAdapter,
  type MapFeature,
  type PaintValue,
  type ScreenPoint,
} from './adapter.ts';

const STYLE_URL = 'mapbox://styles/mapbox/light-v11';
const CLICK_TOLERANCE_PX = 6;

function toValue(value: PaintValue): string | ExpressionSpecification {
  return typeof value === 'string' ? value : ['get', value.property];
}

function toExpression(filter: LayerFilter): ExpressionSpecification {
  switch (filter.kind) {
    case 'all':
      return ['boolean', true];
    case 'none':
      return ['boolean', false];
    case 'eq':
      return ['==', ['get', filter.property], filter.value];
    case 'in':
      return ['in', ['get', filter.property], ['literal', [...filter.values]]];
  }
}

class MapboxAdapter implements MapAdapter {
  private readonly map: mapboxgl.Map;

  constructor(map: mapboxgl.Map) {
    this.map = map;
  }

  setSource(id: string, data: FeatureCollection): void {
    const source = this.map.getSource<GeoJSONSource>(id);
    if (source === undefined) {
      this.map.addSource(id, {type: 'geojson', data});
    } else {
      source.setData(data);
    }
  }

  addLayer(spec: LayerSpec): void {
    const base = {
      id: spec.id,
      source: spec.source,
      filter: toExpression(spec.filter ?? {kind: 'all'}),
      ...(spec.minZoom === undefined ? {} : {minzoom: spec.minZoom}),
    };
    if (spec.kind === 'line') {
      this.map.addLayer({
        ...base,
        type: 'line',
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {
          'line-color': toValue(spec.paint.color),
          'line-width': spec.paint.width,
          'line-opacity': spec.paint.opacity,
        },
      });
    } else {
      this.map.addLayer({
        ...base,
        type: 'circle',
        paint: {
          'circle-color': toValue(spec.paint.color),
          'circle-radius': spec.paint.radius,
          'circle-stroke-color': spec.paint.strokeColor,
          'circle-stroke-width': spec.paint.strokeWidth,
        },
      });
    }
  }

  removeLayer(id: string): void {
    if (this.map.getLayer(id) !== undefined) this.map.removeLayer(id);
  }

  setFilter(layerId: string, filter: LayerFilter): void {
    this.map.setFilter(layerId, toExpression(filter));
  }

  setOpacity(layerId: string, opacity: number): void {
    const layer = this.map.getLayer(layerId);
    if (layer?.type === 'line') this.map.setPaintProperty(layerId, 'line-opacity', opacity);
    if (layer?.type === 'circle') this.map.setPaintProperty(layerId, 'circle-opacity', opacity);
  }

  fitBounds(bounds: Bounds): void {
    this.map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {padding: 48, maxZoom: 15, duration: 600},
    );
  }

  onFeatureClick(layerIds: readonly string[], handler: (feature: MapFeature) => void): () => void {
    const listener = (event: MapMouseEvent): void => {
      const feature = this.pick(event.point, layerIds);
      if (feature !== null) handler(feature);
    };
    this.map.on('click', listener);
    return () => {
      this.map.off('click', listener);
    };
  }

  onFeatureHover(
    layerIds: readonly string[],
    handler: (feature: MapFeature | null, point: ScreenPoint) => void,
  ): () => void {
    const move = (event: MapMouseEvent): void => {
      const feature = this.pick(event.point, layerIds);
      this.map.getCanvas().style.cursor = feature === null ? '' : 'pointer';
      handler(feature, {x: event.point.x, y: event.point.y});
    };
    const out = (): void => handler(null, {x: 0, y: 0});
    this.map.on('mousemove', move);
    this.map.on('mouseout', out);
    return () => {
      this.map.off('mousemove', move);
      this.map.off('mouseout', out);
    };
  }

  destroy(): void {
    this.map.remove();
  }

  private pick(point: ScreenPoint, layerIds: readonly string[]): MapFeature | null {
    const box: [PointLike, PointLike] = [
      [point.x - CLICK_TOLERANCE_PX, point.y - CLICK_TOLERANCE_PX],
      [point.x + CLICK_TOLERANCE_PX, point.y + CLICK_TOLERANCE_PX],
    ];
    const existing = layerIds.filter((id) => this.map.getLayer(id) !== undefined);
    const features = this.map.queryRenderedFeatures(box, {layers: existing});
    for (const layerId of layerIds) {
      const feature = features.find((f) => f.layer?.id === layerId);
      if (feature !== undefined) return {layerId, properties: feature.properties ?? {}};
    }
    return null;
  }
}

/** Resolves once the style has loaded; rejects if Mapbox refuses the token. */
export function createMapboxAdapter(container: HTMLElement, token: string): Promise<MapAdapter> {
  mapboxgl.accessToken = token;
  const map = new mapboxgl.Map({container, style: STYLE_URL, center: [-98, 39], zoom: 3});
  return new Promise((resolve, reject) => {
    let loaded = false;
    map.on('error', (event) => {
      const error = event.error;
      const status = 'status' in error ? error.status : undefined;
      if (!loaded && (status === 401 || status === 403)) {
        map.remove();
        reject(new MapUnavailableError('invalid_token'));
      }
    });
    map.on('load', () => {
      loaded = true;
      resolve(new MapboxAdapter(map));
    });
  });
}
```

`src/map/create-map.ts`:

```ts
import {MapUnavailableError, type MapAdapter} from './adapter.ts';

export async function createMap(container: HTMLElement): Promise<MapAdapter> {
  if (import.meta.env.VITE_MAP_PROVIDER === 'fake') {
    const {createFakeAdapter} = await import('./fake-adapter.ts');
    return await createFakeAdapter(container);
  }
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (token === undefined || token.length === 0) throw new MapUnavailableError('missing_token');
  const {createMapboxAdapter} = await import('./mapbox-adapter.ts');
  return await createMapboxAdapter(container, token);
}
```

- [ ] **Step 8: Type-check and commit**

Run: `npx tsc -b && npx vitest run`
Expected: no type errors; tests PASS. If `tsc` reports that a Mapbox type name (`ExpressionSpecification`, `GeoJSONSource`, `MapMouseEvent`, `PointLike`) is not exported, look up the correct export in `node_modules/mapbox-gl/dist/mapbox-gl.d.ts` and fix the import. Change nothing else.

```bash
git add src/map
git commit -m "feat: add provider-neutral map adapter with Mapbox and fake implementations"
```

---
### Task 12: Explorer sidebar views

**Files:**
- Create: `src/ui/use-async.ts`, `src/ui/format.ts`, `src/ui/route-filter.ts`, `src/ui/error-message.tsx`, `src/ui/route-list.tsx`, `src/ui/route-detail.tsx`, `src/ui/stop-detail.tsx`, `src/ui/feed-info.tsx`
- Test: `src/ui/format_test.ts`, `src/ui/route-filter_test.ts`

**Interfaces:**
- Consumes: `FeedApi` (Task 9), shared types (Tasks 4–8), `routeLabel`, `CATEGORY_LABELS`, `RouteCategory` (Task 7), time helpers (Task 1).
- Produces:

```ts
// src/ui/use-async.ts
export type AsyncState<T> = {readonly status: 'loading'} | {readonly status: 'ok'; readonly value: T} | {readonly status: 'error'; readonly error: unknown};
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T>;

// src/ui/format.ts
export function formatServiceDate(date: string | null): string;          // '20261012' -> 'Oct 12, 2026'; null -> '—'
export function formatBytes(bytes: number): string;                      // 1536 -> '1.5 KB'
export function formatDeparture(secs: number): {readonly clock: string; readonly nextDay: boolean};
export function describeProgress(progress: ImportProgress): string;

// src/ui/route-filter.ts
export function filterRoutes(routes: readonly RouteSummary[], query: string, categories: ReadonlySet<RouteCategory>): RouteSummary[];
export function categoriesPresent(routes: readonly RouteSummary[]): RouteCategory[];

// components
export function ErrorMessage(props: {readonly error: unknown}): ReactElement;
export function RouteList(props: {readonly routes: readonly RouteSummary[]; readonly onSelect: (routeId: string) => void}): ReactElement;
export function RouteDetailView(props: RouteDetailViewProps): ReactElement;
export function StopDetailView(props: StopDetailViewProps): ReactElement;
export function FeedInfo(props: {readonly feed: FeedRecord; readonly summary: FeedSummary}): ReactElement;
```

Accessible names E2E tests rely on: the route list heading is **"Routes"**; route buttons are named by `routeLabel` (badge is `aria-hidden`); the route detail heading is the `routeLabel`; stop buttons in route detail are named by stop name; the stop detail heading is the stop name; departures are a table named **"Departures"** whose time cell reads `HH:MM` or `HH:MM +1`; unknown route/stop shows **"Route not found in this feed."** / **"Stop not found in this feed."**.

- [ ] **Step 1: Write the failing tests**

`src/ui/format_test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {describeProgress, formatBytes, formatDeparture, formatServiceDate} from './format.ts';

describe('format', () => {
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
```

`src/ui/route-filter_test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import type {RouteSummary} from '../shared/types.ts';
import {categoriesPresent, filterRoutes} from './route-filter.ts';

function route(routeId: string, shortName: string, longName: string, category: RouteSummary['category']): RouteSummary {
  return {
    routeId,
    agencyId: null,
    shortName,
    longName,
    routeType: 3,
    category,
    color: '#000000',
    textColor: '#ffffff',
    sortOrder: null,
  };
}

const ROUTES = [
  route('R10', '10', 'Airport - Central', 'bus'),
  route('R20', '20', 'Central - Furnace Creek', 'bus'),
  route('F1', 'F', 'Harbor Ferry', 'ferry'),
];

describe('route filtering', () => {
  it('matches names and ids case-insensitively', () => {
    expect(filterRoutes(ROUTES, 'central', new Set()).map((r) => r.routeId)).toEqual(['R10', 'R20']);
    expect(filterRoutes(ROUTES, 'f1', new Set()).map((r) => r.routeId)).toEqual(['F1']);
    expect(filterRoutes(ROUTES, '  ', new Set())).toHaveLength(3);
  });
  it('filters by selected categories', () => {
    expect(filterRoutes(ROUTES, '', new Set(['ferry'])).map((r) => r.routeId)).toEqual(['F1']);
  });
  it('lists the categories present in label order', () => {
    expect(categoriesPresent(ROUTES)).toEqual(['bus', 'ferry']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/ui/format.ts` and `src/ui/route-filter.ts`**

`src/ui/format.ts`:

```ts
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
```

`src/ui/route-filter.ts`:

```ts
import {CATEGORY_LABELS, routeLabel, type RouteCategory} from '../gtfs/route-types.ts';
import type {RouteSummary} from '../shared/types.ts';

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

export function filterRoutes(
  routes: readonly RouteSummary[],
  query: string,
  categories: ReadonlySet<RouteCategory>,
): RouteSummary[] {
  const needle = query.trim().toLowerCase();
  return routes.filter((route) => {
    if (categories.size > 0 && !categories.has(route.category)) return false;
    if (needle.length === 0) return true;
    return `${routeLabel(route)} ${route.routeId}`.toLowerCase().includes(needle);
  });
}

export function categoriesPresent(routes: readonly RouteSummary[]): RouteCategory[] {
  const present = new Set(routes.map((route) => route.category));
  return [...present].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui`
Expected: PASS.

- [ ] **Step 5: Implement the hook and components**

`src/ui/use-async.ts`:

```ts
import {useEffect, useState, type DependencyList} from 'react';

export type AsyncState<T> =
  | {readonly status: 'loading'}
  | {readonly status: 'ok'; readonly value: T}
  | {readonly status: 'error'; readonly error: unknown};

/** Runs `load` whenever `deps` change, ignoring results from superseded runs. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({status: 'loading'});
  useEffect(() => {
    let cancelled = false;
    setState({status: 'loading'});
    load().then(
      (value) => {
        if (!cancelled) setState({status: 'ok', value});
      },
      (error: unknown) => {
        if (!cancelled) setState({status: 'error', error});
      },
    );
    return () => {
      cancelled = true;
    };
    // `load` is recreated every render; callers list its inputs in `deps`.
    // oxlint-disable-next-line react/exhaustive-deps
  }, deps);
  return state;
}
```

`src/ui/error-message.tsx`:

```tsx
import type {ReactElement} from 'react';

export function ErrorMessage({error}: {readonly error: unknown}): ReactElement {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="error">
      Something went wrong: {message}
    </p>
  );
}
```

`src/ui/route-list.tsx`:

```tsx
import {useMemo, useState, type ReactElement} from 'react';
import {CATEGORY_LABELS, routeLabel, type RouteCategory} from '../gtfs/route-types.ts';
import type {RouteSummary} from '../shared/types.ts';
import {categoriesPresent, filterRoutes} from './route-filter.ts';

export interface RouteListProps {
  readonly routes: readonly RouteSummary[];
  readonly onSelect: (routeId: string) => void;
}

export function RouteList({routes, onSelect}: RouteListProps): ReactElement {
  const [query, setQuery] = useState('');
  const [categories, setCategories] = useState<ReadonlySet<RouteCategory>>(new Set());
  const present = useMemo(() => categoriesPresent(routes), [routes]);
  const visible = useMemo(() => filterRoutes(routes, query, categories), [routes, query, categories]);

  const toggle = (category: RouteCategory): void => {
    setCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  return (
    <section className="panel">
      <h2>Routes</h2>
      <input
        type="search"
        aria-label="Search routes"
        placeholder="Search routes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {present.length > 1 && (
        <div className="chips" role="group" aria-label="Filter by mode">
          {present.map((category) => (
            <button
              key={category}
              type="button"
              className="chip"
              aria-pressed={categories.has(category)}
              onClick={() => toggle(category)}
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>
      )}
      <ul className="route-list">
        {visible.map((route) => (
          <li key={route.routeId}>
            <button type="button" className="route-row" onClick={() => onSelect(route.routeId)}>
              <span
                className="route-badge"
                aria-hidden="true"
                style={{background: route.color, color: route.textColor}}
              >
                {route.shortName ?? route.routeId}
              </span>
              <span>{routeLabel(route)}</span>
            </button>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="muted">No routes match.</p>}
    </section>
  );
}
```

`src/ui/route-detail.tsx`:

```tsx
import {useEffect, useState, type ReactElement} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import {routeLabel} from '../gtfs/route-types.ts';
import {ErrorMessage} from './error-message.tsx';
import {useAsync} from './use-async.ts';

export interface RouteDetailViewProps {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly routeId: string;
  readonly onBack: () => void;
  readonly onSelectStop: (stopId: string) => void;
  /** Reports the stops of the displayed pattern so the map can show them. */
  readonly onPatternStops: (stopIds: readonly string[]) => void;
}

export function RouteDetailView({
  service,
  feedId,
  routeId,
  onBack,
  onSelectStop,
  onPatternStops,
}: RouteDetailViewProps): ReactElement {
  const state = useAsync(() => service.getRouteDetail(feedId, routeId), [service, feedId, routeId]);
  const [patternId, setPatternId] = useState<string | null>(null);
  const detail = state.status === 'ok' ? state.value : null;
  const pattern =
    detail?.patterns.find((p) => p.patternId === patternId) ?? detail?.patterns[0] ?? null;

  useEffect(() => {
    onPatternStops(pattern === null ? [] : pattern.stops.map((stop) => stop.stopId));
  }, [pattern, onPatternStops]);

  const back = (
    <button type="button" className="link" onClick={onBack}>
      ← All routes
    </button>
  );
  if (state.status === 'loading') return <p className="muted">Loading route…</p>;
  if (state.status === 'error') return <ErrorMessage error={state.error} />;
  if (detail === null) {
    return (
      <section className="panel">
        {back}
        <p role="status">Route not found in this feed.</p>
      </section>
    );
  }
  const {route} = detail;
  return (
    <section className="panel">
      {back}
      <h2>
        <span className="route-badge" aria-hidden="true" style={{background: route.color, color: route.textColor}}>
          {route.shortName ?? route.routeId}
        </span>{' '}
        {routeLabel(route)}
      </h2>
      {detail.patterns.length > 1 && (
        <label className="field">
          Pattern
          <select value={pattern?.patternId ?? ''} onChange={(event) => setPatternId(event.target.value)}>
            {detail.patterns.map((p) => (
              <option key={p.patternId} value={p.patternId}>
                {`Direction ${p.directionId} · ${p.headsign ?? 'No headsign'} · ${p.tripCount} trips`}
              </option>
            ))}
          </select>
        </label>
      )}
      {pattern === null ? (
        <p className="muted">This route has no trips.</p>
      ) : (
        <ol className="stop-list">
          {pattern.stops.map((stop, index) => (
            <li key={`${stop.stopId}-${index}`}>
              <button type="button" className="link" onClick={() => onSelectStop(stop.stopId)}>
                {stop.name}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

Because the badge is `aria-hidden`, the heading's accessible name is exactly `10 · Airport - Central`.

`src/ui/stop-detail.tsx`:

```tsx
import type {ReactElement} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import {routeLabel} from '../gtfs/route-types.ts';
import {fromIsoDate, todayInTimeZone, toIsoDate} from '../gtfs/time.ts';
import {ErrorMessage} from './error-message.tsx';
import {formatDeparture} from './format.ts';
import {useAsync} from './use-async.ts';

export interface StopDetailViewProps {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly stopId: string;
  /** YYYYMMDD from the URL, or null for today in the feed's time zone. */
  readonly date: string | null;
  readonly timezone: string | null;
  readonly onBack: () => void;
  readonly onSelectRoute: (routeId: string) => void;
  readonly onDateChange: (date: string) => void;
}

export function StopDetailView({
  service,
  feedId,
  stopId,
  date,
  timezone,
  onBack,
  onSelectRoute,
  onDateChange,
}: StopDetailViewProps): ReactElement {
  const serviceDate = date ?? todayInTimeZone(timezone, new Date());
  const detail = useAsync(() => service.getStopDetail(feedId, stopId), [service, feedId, stopId]);
  const departures = useAsync(
    () => service.getStopDepartures(feedId, stopId, serviceDate),
    [service, feedId, stopId, serviceDate],
  );
  const back = (
    <button type="button" className="link" onClick={onBack}>
      ← Back
    </button>
  );

  if (detail.status === 'loading') return <p className="muted">Loading stop…</p>;
  if (detail.status === 'error') return <ErrorMessage error={detail.error} />;
  if (detail.value === null) {
    return (
      <section className="panel">
        {back}
        <p role="status">Stop not found in this feed.</p>
      </section>
    );
  }
  const {stop, routes} = detail.value;
  return (
    <section className="panel">
      {back}
      <h2>{stop.name}</h2>
      {stop.code !== null && <p className="muted">Stop code {stop.code}</p>}
      <div className="chips" aria-label="Routes serving this stop">
        {routes.map((route) => (
          <button
            key={route.routeId}
            type="button"
            className="route-badge"
            style={{background: route.color, color: route.textColor}}
            aria-label={routeLabel(route)}
            onClick={() => onSelectRoute(route.routeId)}
          >
            {route.shortName ?? route.routeId}
          </button>
        ))}
      </div>
      <label className="field">
        Service date
        <input
          type="date"
          value={toIsoDate(serviceDate)}
          onChange={(event) => {
            const next = fromIsoDate(event.target.value);
            if (next !== null) onDateChange(next);
          }}
        />
      </label>
      {departures.status === 'loading' && <p className="muted">Loading departures…</p>}
      {departures.status === 'error' && <ErrorMessage error={departures.error} />}
      {departures.status === 'ok' && departures.value.length === 0 && (
        <p className="muted">No departures on this date.</p>
      )}
      {departures.status === 'ok' && departures.value.length > 0 && (
        <table className="departures" aria-label="Departures">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Route</th>
              <th scope="col">To</th>
            </tr>
          </thead>
          <tbody>
            {departures.value.map((departure) => {
              const {clock, nextDay} = formatDeparture(departure.departureSecs);
              return (
                <tr key={`${departure.tripId}-${departure.stopId}-${departure.departureSecs}`}>
                  <td>{nextDay ? `${clock} +1` : clock}</td>
                  <td>
                    <span
                      className="route-badge"
                      style={{background: departure.routeColor, color: departure.routeTextColor}}
                    >
                      {departure.routeShortName ?? departure.routeId}
                    </span>
                  </td>
                  <td>{departure.headsign ?? departure.routeLongName ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

`src/ui/feed-info.tsx`:

```tsx
import type {ReactElement} from 'react';
import type {FeedRecord, FeedSummary} from '../shared/types.ts';
import {formatServiceDate} from './format.ts';

const COUNTED_TABLES = ['agency', 'routes', 'stops', 'trips', 'stop_times', 'shapes'];

const SOURCE_LABELS: Readonly<Record<FeedRecord['sourceKind'], string>> = {
  catalog: 'Catalog',
  url: 'URL',
  file: 'Uploaded file',
};

export function FeedInfo({feed, summary}: {readonly feed: FeedRecord; readonly summary: FeedSummary}): ReactElement {
  return (
    <details className="panel feed-info">
      <summary>Feed details</summary>
      <dl>
        <dt>Agencies</dt>
        <dd>{summary.agencies.map((agency) => agency.name).join(', ') || '—'}</dd>
        {summary.feedInfo !== null && (
          <>
            <dt>Publisher</dt>
            <dd>{summary.feedInfo.publisherName ?? '—'}</dd>
            <dt>Version</dt>
            <dd>{summary.feedInfo.version ?? '—'}</dd>
          </>
        )}
        <dt>Service dates</dt>
        <dd>
          {formatServiceDate(summary.serviceStart)} – {formatServiceDate(summary.serviceEnd)}
        </dd>
        <dt>Time zone</dt>
        <dd>{summary.timezone ?? 'Invalid in feed; using your time zone'}</dd>
        <dt>Source</dt>
        <dd>
          {SOURCE_LABELS[feed.sourceKind]}: {feed.sourceRef}
        </dd>
        <dt>Imported</dt>
        <dd>{new Date(feed.importedAt).toLocaleString()}</dd>
        <dt>Import notes</dt>
        <dd>{summary.issueCount === 0 ? 'None' : `${summary.issueCount} recorded`}</dd>
      </dl>
      <table className="counts">
        <tbody>
          {COUNTED_TABLES.map((table) => (
            <tr key={table}>
              <th scope="row">{table}</th>
              <td>{(summary.counts[table] ?? 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
```

- [ ] **Step 6: Type-check, lint, and commit**

Run: `npx tsc -b && npm run lint && npx vitest run`
Expected: no errors; tests PASS.

```bash
git add src/ui
git commit -m "feat: add route list, route detail, stop detail, and feed info views"
```

---

### Task 13: App assembly — notices, feed picker, import flow, map view

**Files:**
- Create: `src/app.tsx`, `src/map/map-view.tsx`, `src/ui/host-notice.tsx`, `src/ui/use-import.ts`, `src/ui/feed-picker.tsx`
- Modify: `src/main.tsx`, `src/index.css` (replace), `index.html` (title)
- Delete: `src/App.tsx`, `src/App.css`, `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`

**Interfaces:**
- Consumes: everything from Tasks 9–12.
- Produces: `export function App(): ReactElement` (`src/app.tsx`); `export function MapView(props: MapViewProps): ReactElement`.

Accessible names E2E tests rely on: feed picker heading **"Choose a feed"**; file input labeled **"Upload GTFS zip"** with `data-testid="file-input"`; URL input **"Feed URL"** and button **"Import URL"**; catalog buttons **"Import <name>"**; import failures render in `role="alert"`; header button **"Change feed"**; missing-feed notice contains **"isn't saved in this browser"**; other-tab screen text **"already open in another tab"** with button **"Take over"**; taken-over screen text **"opened in another tab"** with button **"Use it here"**.

- [ ] **Step 1: Implement `src/ui/host-notice.tsx`**

```tsx
import type {ReactElement} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {HostState} from '../db-client/worker-host.ts';

export interface HostNoticeProps {
  readonly state: HostState<FeedApi>;
  readonly onTakeOver: () => void;
}

export function HostNotice({state, onTakeOver}: HostNoticeProps): ReactElement {
  let body: ReactElement;
  switch (state.kind) {
    case 'starting':
    case 'ready':
      body = <p className="muted">Starting…</p>;
      break;
    case 'other-tab':
      body = (
        <>
          <p>GTFS Visualizer is already open in another tab.</p>
          <p className="muted">Close it, or use the app here instead.</p>
          <button type="button" onClick={onTakeOver}>
            Take over
          </button>
        </>
      );
      break;
    case 'taken-over':
      body = (
        <>
          <p>This window was disconnected because the app was opened in another tab.</p>
          <button type="button" onClick={onTakeOver}>
            Use it here
          </button>
        </>
      );
      break;
    case 'unsupported':
      body = (
        <>
          <p>This browser can't run GTFS Visualizer: {state.reason}</p>
          <p className="muted">Use a current version of Chrome, Edge, Firefox, or Safari.</p>
        </>
      );
      break;
    case 'crashed':
      body = (
        <>
          <p role="alert">The data worker stopped unexpectedly: {state.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </>
      );
      break;
  }
  return (
    <main className="notice-page">
      <h1>GTFS Visualizer</h1>
      {body}
    </main>
  );
}
```

- [ ] **Step 2: Implement `src/ui/use-import.ts`**

```ts
import * as Comlink from 'comlink';
import {useCallback, useState} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {FeedRecord, ImportFailure, ImportProgress, ImportSource} from '../shared/types.ts';
import {formatBytes} from './format.ts';

export interface ImportController {
  readonly running: boolean;
  readonly progress: ImportProgress | null;
  readonly failure: ImportFailure | null;
  run(source: ImportSource, sizeHint: number | null): Promise<FeedRecord | null>;
}

async function requestPersistence(): Promise<void> {
  if (typeof navigator.storage?.persist !== 'function') return;
  if (await navigator.storage.persisted()) return;
  await navigator.storage.persist();
}

export function useImport(service: FeedApi): ImportController {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);

  const run = useCallback(
    async (source: ImportSource, sizeHint: number | null): Promise<FeedRecord | null> => {
      if (sizeHint !== null) {
        const check = await service.checkStorage(sizeHint);
        if (
          !check.ok &&
          !window.confirm(
            `This feed may need about ${formatBytes(sizeHint * 3)} of browser storage, but only ` +
              `${formatBytes(check.availableBytes ?? 0)} is free. Import anyway?`,
          )
        ) {
          return null;
        }
      }
      setRunning(true);
      setFailure(null);
      setProgress(null);
      try {
        const result = await service.importFeed(
          source,
          Comlink.proxy((next: ImportProgress) => setProgress(next)),
        );
        if (!result.ok) {
          setFailure(result);
          return null;
        }
        void requestPersistence();
        return result.feed;
      } finally {
        setRunning(false);
      }
    },
    [service],
  );

  return {running, progress, failure, run};
}
```

- [ ] **Step 3: Implement `src/ui/feed-picker.tsx`**

```tsx
import {useState, type ReactElement} from 'react';
import {fetchCatalog, isUpdateAvailable, type CatalogFeed} from '../catalog/catalog.ts';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {FeedRecord, ImportFailure, ImportSource} from '../shared/types.ts';
import {describeProgress, formatServiceDate} from './format.ts';
import {useAsync} from './use-async.ts';
import {useImport} from './use-import.ts';

export interface FeedPickerProps {
  readonly service: FeedApi;
  readonly catalogBaseUrl: string | null;
  readonly onOpen: (feedId: string) => void;
}

function catalogSource(entry: CatalogFeed): ImportSource {
  return {kind: 'catalog', id: entry.id, name: entry.name, url: entry.zipUrl, sha256: entry.sha256};
}

function ImportFailureView({failure}: {readonly failure: ImportFailure}): ReactElement {
  return (
    <div role="alert" className="error">
      <p>{failure.code === 'fatal_issues' ? "This feed couldn't be imported:" : failure.message}</p>
      {failure.issues.length > 0 && (
        <ul>
          {failure.issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FeedPicker({service, catalogBaseUrl, onOpen}: FeedPickerProps): ReactElement {
  const [version, setVersion] = useState(0);
  const [url, setUrl] = useState('');
  const feeds = useAsync(() => service.listFeeds(), [service, version]);
  const catalog = useAsync(
    async () => (catalogBaseUrl === null ? [] : await fetchCatalog(catalogBaseUrl)),
    [catalogBaseUrl],
  );
  const importer = useImport(service);
  const saved = feeds.status === 'ok' ? feeds.value : [];
  const catalogFeeds = catalog.status === 'ok' ? catalog.value : [];
  const savedIds = new Set(saved.map((feed) => feed.id));

  const start = async (source: ImportSource, sizeHint: number | null): Promise<void> => {
    const feed = await importer.run(source, sizeHint);
    setVersion((v) => v + 1);
    if (feed !== null) onOpen(feed.id);
  };

  const catalogEntryFor = (feed: FeedRecord): CatalogFeed | undefined =>
    feed.sourceKind === 'catalog' ? catalogFeeds.find((entry) => entry.id === feed.sourceRef) : undefined;

  const reimport = async (feed: FeedRecord): Promise<void> => {
    if (feed.sourceKind === 'url') {
      await start({kind: 'url', url: feed.sourceRef}, null);
      return;
    }
    const entry = catalogEntryFor(feed);
    if (entry !== undefined && entry.available) await start(catalogSource(entry), entry.size);
  };

  const remove = async (feed: FeedRecord): Promise<void> => {
    if (!window.confirm(`Delete ${feed.name} from this browser?`)) return;
    await service.deleteFeed(feed.id);
    setVersion((v) => v + 1);
  };

  return (
    <section className="panel">
      <h2>Choose a feed</h2>
      {importer.running && (
        <p role="status" className="progress">
          {importer.progress === null ? 'Starting import…' : describeProgress(importer.progress)}
        </p>
      )}
      {importer.failure !== null && <ImportFailureView failure={importer.failure} />}

      <h3>Your feeds</h3>
      {saved.length === 0 ? (
        <p className="muted">No feeds imported yet.</p>
      ) : (
        <ul className="feed-list">
          {saved.map((feed) => {
            const entry = catalogEntryFor(feed);
            return (
              <li key={feed.id}>
                <button
                  type="button"
                  className="feed-open"
                  disabled={importer.running}
                  onClick={() => onOpen(feed.id)}
                >
                  {feed.name}
                </button>
                <span className="muted">
                  {formatServiceDate(feed.serviceStart)} – {formatServiceDate(feed.serviceEnd)}
                </span>
                {entry !== undefined && isUpdateAvailable(entry, feed) && (
                  <span className="badge">Update available</span>
                )}
                <span className="row-actions">
                  {feed.sourceKind !== 'file' && (
                    <button
                      type="button"
                      disabled={importer.running}
                      aria-label={`Re-import ${feed.name}`}
                      onClick={() => void reimport(feed)}
                    >
                      Re-import
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={importer.running}
                    aria-label={`Delete ${feed.name}`}
                    onClick={() => void remove(feed)}
                  >
                    Delete
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {catalogBaseUrl !== null && (
        <>
          <h3>Catalog</h3>
          {catalog.status === 'loading' && <p className="muted">Loading catalog…</p>}
          {catalog.status === 'error' && <p className="muted">The catalog is unavailable right now.</p>}
          <ul className="feed-list">
            {catalogFeeds.map((entry) => {
              const verb = savedIds.has(entry.id) ? 'Re-import' : 'Import';
              return (
                <li key={entry.id}>
                  <span>{entry.name}</span>
                  <span className="muted">{entry.region}</span>
                  <button
                    type="button"
                    disabled={!entry.available || importer.running}
                    aria-label={`${verb} ${entry.name}`}
                    onClick={() => void start(catalogSource(entry), entry.size)}
                  >
                    {entry.available ? verb : 'Not mirrored yet'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h3>Import your own</h3>
      <form
        className="url-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = url.trim();
          if (trimmed.length > 0) void start({kind: 'url', url: trimmed}, null);
        }}
      >
        <input
          type="url"
          aria-label="Feed URL"
          placeholder="https://example.com/gtfs.zip"
          value={url}
          required
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit" disabled={importer.running}>
          Import URL
        </button>
      </form>
      <label className="file-label">
        Upload a GTFS zip
        <input
          type="file"
          accept=".zip,application/zip"
          aria-label="Upload GTFS zip"
          data-testid="file-input"
          disabled={importer.running}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) void start({kind: 'file', file}, file.size);
          }}
        />
      </label>
    </section>
  );
}
```

- [ ] **Step 4: Implement `src/map/map-view.tsx`**

```tsx
import {useEffect, useRef, useState, type ReactElement} from 'react';
import type {FeatureCollection} from 'geojson';
import type {FeedApi} from '../db-client/feed-api.ts';
import {MapUnavailableError, type MapAdapter} from './adapter.ts';
import {createMap} from './create-map.ts';
import {
  baseLayers,
  boundsOf,
  CLICK_LAYERS,
  EMPTY_COLLECTION,
  selectionStyle,
  SOURCE_ROUTES,
  SOURCE_STOPS,
} from './layers.ts';

export interface MapViewProps {
  readonly service: FeedApi;
  readonly feedId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedStopId: string | null;
  readonly routeStopIds: readonly string[];
  readonly onSelectRoute: (routeId: string) => void;
  readonly onSelectStop: (stopId: string) => void;
}

interface Hover {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

function mapErrorMessage(error: unknown): string {
  if (error instanceof MapUnavailableError) {
    return error.reason === 'missing_token'
      ? 'The map is unavailable: no Mapbox token is configured. Routes and stops still work in the sidebar.'
      : 'The map is unavailable: the Mapbox token was rejected. Routes and stops still work in the sidebar.';
  }
  return `The map failed to load: ${error instanceof Error ? error.message : String(error)}`;
}

export function MapView({
  service,
  feedId,
  selectedRouteId,
  selectedStopId,
  routeStopIds,
  onSelectRoute,
  onSelectStop,
}: MapViewProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [routes, setRoutes] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let disposed = false;
    let created: MapAdapter | null = null;
    createMap(container).then(
      (map) => {
        if (disposed) {
          map.destroy();
          return;
        }
        created = map;
        map.setSource(SOURCE_ROUTES, EMPTY_COLLECTION);
        map.setSource(SOURCE_STOPS, EMPTY_COLLECTION);
        for (const layer of baseLayers()) map.addLayer(layer);
        setAdapter(map);
      },
      (failure: unknown) => {
        if (!disposed) setError(mapErrorMessage(failure));
      },
    );
    return () => {
      disposed = true;
      created?.destroy();
    };
  }, []);

  useEffect(() => {
    if (adapter === null) return;
    const offClick = adapter.onFeatureClick(CLICK_LAYERS, (feature) => {
      const {stopId, routeId} = feature.properties;
      if (typeof stopId === 'string') {
        onSelectStop(stopId);
      } else if (typeof routeId === 'string') {
        onSelectRoute(routeId);
      }
    });
    const offHover = adapter.onFeatureHover(CLICK_LAYERS, (feature, point) => {
      const name = feature?.properties['name'];
      setHover(typeof name === 'string' ? {name, x: point.x, y: point.y} : null);
    });
    return () => {
      offClick();
      offHover();
    };
  }, [adapter, onSelectRoute, onSelectStop]);

  useEffect(() => {
    if (adapter === null) return;
    if (feedId === null) {
      adapter.setSource(SOURCE_ROUTES, EMPTY_COLLECTION);
      adapter.setSource(SOURCE_STOPS, EMPTY_COLLECTION);
      setRoutes(null);
      return;
    }
    let cancelled = false;
    void Promise.all([service.getRouteShapesGeoJSON(feedId), service.getStopsGeoJSON(feedId)]).then(
      ([routeShapes, stops]) => {
        if (cancelled) return;
        adapter.setSource(SOURCE_ROUTES, routeShapes);
        adapter.setSource(SOURCE_STOPS, stops);
        setRoutes(routeShapes);
        const bounds = boundsOf(routeShapes) ?? boundsOf(stops);
        if (bounds !== null) adapter.fitBounds(bounds);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [adapter, service, feedId]);

  useEffect(() => {
    if (adapter === null) return;
    const style = selectionStyle({routeId: selectedRouteId, stopId: selectedStopId, routeStopIds});
    for (const {layerId, filter} of style.filters) adapter.setFilter(layerId, filter);
    for (const {layerId, opacity} of style.opacity) adapter.setOpacity(layerId, opacity);
  }, [adapter, selectedRouteId, selectedStopId, routeStopIds]);

  useEffect(() => {
    if (adapter === null || routes === null || selectedRouteId === null) return;
    const bounds = boundsOf(routes, (p) => p['routeId'] === selectedRouteId);
    if (bounds !== null) adapter.fitBounds(bounds);
  }, [adapter, routes, selectedRouteId]);

  return (
    <div className="map-area">
      <div ref={containerRef} className="map-container" />
      {error !== null && (
        <p role="status" className="map-notice">
          {error}
        </p>
      )}
      {hover !== null && (
        <div className="map-tooltip" style={{left: hover.x + 12, top: hover.y + 12}}>
          {hover.name}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/app.tsx` and update `src/main.tsx`**

`src/app.tsx`:

```tsx
import {useCallback, useEffect, useState, useSyncExternalStore, type ReactElement} from 'react';
import type {FeedApi} from './db-client/feed-api.ts';
import {host} from './db-client/host.ts';
import {MapView} from './map/map-view.tsx';
import type {FeedRecord} from './shared/types.ts';
import {useSelection, type Selection, type UpdateSelection} from './state/url-state.ts';
import {ErrorMessage} from './ui/error-message.tsx';
import {FeedInfo} from './ui/feed-info.tsx';
import {FeedPicker} from './ui/feed-picker.tsx';
import {HostNotice} from './ui/host-notice.tsx';
import {RouteDetailView} from './ui/route-detail.tsx';
import {RouteList} from './ui/route-list.tsx';
import {StopDetailView} from './ui/stop-detail.tsx';
import {useAsync} from './ui/use-async.ts';

const CATALOG_BASE_URL = import.meta.env.VITE_CATALOG_BASE_URL || null;

export function App(): ReactElement {
  const state = useSyncExternalStore(host.subscribe, host.getState);
  useEffect(() => {
    void host.start();
  }, []);
  if (state.kind !== 'ready') {
    return <HostNotice state={state} onTakeOver={() => void host.takeOver()} />;
  }
  return <Explorer service={state.service} />;
}

function Explorer({service}: {readonly service: FeedApi}): ReactElement {
  const [selection, update] = useSelection();
  const [notice, setNotice] = useState<string | null>(null);
  const [routeStopIds, setRouteStopIds] = useState<readonly string[]>([]);
  const feedId = selection.feed;
  const feed = useAsync(
    async () => (feedId === null ? null : await service.openFeed(feedId)),
    [service, feedId],
  );
  const activeFeed = feed.status === 'ok' && feed.value !== null && feed.value.id === feedId ? feed.value : null;

  useEffect(() => {
    if (feedId !== null && feed.status === 'ok' && feed.value === null) {
      setNotice(`The feed “${feedId}” isn't saved in this browser. Import it to view it.`);
      update({feed: null}, {replace: true});
    }
  }, [feed, feedId, update]);

  useEffect(() => {
    if (selection.route === null) setRouteStopIds([]);
  }, [selection.route]);

  const selectRoute = useCallback((routeId: string) => update({route: routeId, stop: null}), [update]);
  const selectStop = useCallback((stopId: string) => update({stop: stopId}), [update]);
  const openFeed = useCallback(
    (id: string) => {
      setNotice(null);
      update({feed: id});
    },
    [update],
  );

  let content: ReactElement;
  if (feedId === null) {
    content = <FeedPicker service={service} catalogBaseUrl={CATALOG_BASE_URL} onOpen={openFeed} />;
  } else if (feed.status === 'error') {
    content = <ErrorMessage error={feed.error} />;
  } else if (activeFeed === null) {
    content = <p className="muted">Opening feed…</p>;
  } else {
    content = (
      <FeedContent
        service={service}
        feed={activeFeed}
        selection={selection}
        update={update}
        onSelectRoute={selectRoute}
        onSelectStop={selectStop}
        onPatternStops={setRouteStopIds}
      />
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="app-header">
          <h1>GTFS Visualizer</h1>
          {feedId !== null && (
            <button type="button" className="link" onClick={() => update({feed: null})}>
              Change feed
            </button>
          )}
        </header>
        {notice !== null && (
          <div role="status" className="notice">
            {notice}{' '}
            <button type="button" className="link" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {content}
      </aside>
      <MapView
        service={service}
        feedId={activeFeed?.id ?? null}
        selectedRouteId={selection.route}
        selectedStopId={selection.stop}
        routeStopIds={routeStopIds}
        onSelectRoute={selectRoute}
        onSelectStop={selectStop}
      />
    </div>
  );
}

interface FeedContentProps {
  readonly service: FeedApi;
  readonly feed: FeedRecord;
  readonly selection: Selection;
  readonly update: UpdateSelection;
  readonly onSelectRoute: (routeId: string) => void;
  readonly onSelectStop: (stopId: string) => void;
  readonly onPatternStops: (stopIds: readonly string[]) => void;
}

function FeedContent({
  service,
  feed,
  selection,
  update,
  onSelectRoute,
  onSelectStop,
  onPatternStops,
}: FeedContentProps): ReactElement {
  const summary = useAsync(() => service.getFeedSummary(feed.id), [service, feed.id]);
  const routes = useAsync(() => service.getRoutes(feed.id), [service, feed.id]);

  if (summary.status === 'loading') return <p className="muted">Loading feed…</p>;
  if (summary.status === 'error') return <ErrorMessage error={summary.error} />;

  if (selection.stop !== null) {
    return (
      <StopDetailView
        service={service}
        feedId={feed.id}
        stopId={selection.stop}
        date={selection.date}
        timezone={summary.value.timezone}
        onBack={() => update({stop: null, date: null})}
        onSelectRoute={onSelectRoute}
        onDateChange={(date) => update({date}, {replace: true})}
      />
    );
  }
  if (selection.route !== null) {
    return (
      <RouteDetailView
        service={service}
        feedId={feed.id}
        routeId={selection.route}
        onBack={() => update({route: null})}
        onSelectStop={onSelectStop}
        onPatternStops={onPatternStops}
      />
    );
  }
  return (
    <>
      <p className="feed-name">{feed.name}</p>
      {routes.status === 'loading' && <p className="muted">Loading routes…</p>}
      {routes.status === 'error' && <ErrorMessage error={routes.error} />}
      {routes.status === 'ok' && <RouteList routes={routes.value} onSelect={onSelectRoute} />}
      <FeedInfo feed={feed} summary={summary.value} />
    </>
  );
}
```

`src/main.tsx`:

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app.tsx';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

In `index.html`, change `<title>gtfs-visualizer</title>` to `<title>GTFS Visualizer</title>`.

- [ ] **Step 6: Replace `src/index.css`**

```css
:root {
  --bg: #f8fafc;
  --panel: #ffffff;
  --text: #0f172a;
  --muted: #64748b;
  --border: #e2e8f0;
  --accent: #2563eb;
  --error: #b91c1c;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--text);
  background: var(--bg);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1120;
    --panel: #111827;
    --text: #e5e7eb;
    --muted: #94a3b8;
    --border: #1f2937;
    --accent: #60a5fa;
    --error: #f87171;
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
button, input, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.6; }

.app { display: grid; grid-template-columns: 380px 1fr; height: 100vh; }
.sidebar { overflow-y: auto; border-right: 1px solid var(--border); background: var(--panel); padding: 12px 16px; }
.app-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.app-header h1 { font-size: 1.1rem; margin: 4px 0 12px; }
.panel { margin-bottom: 16px; }
.panel h2 { font-size: 1.05rem; margin: 8px 0; }
.panel h3 { font-size: 0.9rem; margin: 16px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.muted { color: var(--muted); font-size: 0.9rem; }
.error { color: var(--error); }
.notice { border: 1px solid var(--border); border-radius: 6px; padding: 8px; margin-bottom: 12px; }
.link { background: none; border: none; padding: 0; color: var(--accent); text-align: left; }
.feed-name { font-weight: 600; margin: 0 0 8px; }

input[type='search'], input[type='url'], select { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
.field { display: grid; gap: 4px; margin: 8px 0; font-size: 0.9rem; }
.url-form { display: flex; gap: 6px; margin-bottom: 8px; }
.file-label { display: grid; gap: 4px; font-size: 0.9rem; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.chip { border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; background: var(--panel); color: var(--text); }
.chip[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: #fff; }

.route-list, .feed-list, .stop-list { list-style: none; margin: 0; padding: 0; }
.stop-list { list-style: decimal; padding-left: 24px; }
.stop-list li { padding: 3px 0; }
.route-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 4px; background: none; border: none; border-bottom: 1px solid var(--border); color: var(--text); text-align: left; }
.route-badge { display: inline-block; min-width: 2.2em; padding: 1px 6px; border-radius: 4px; border: none; font-weight: 600; font-size: 0.85rem; text-align: center; }
.feed-list li { display: grid; gap: 2px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.feed-open { background: none; border: none; padding: 0; color: var(--accent); font-weight: 600; text-align: left; }
.row-actions { display: flex; gap: 6px; }
.badge { justify-self: start; font-size: 0.75rem; padding: 1px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; }

.departures { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.departures th, .departures td { text-align: left; padding: 4px; border-bottom: 1px solid var(--border); }
.feed-info dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 0.9rem; }
.feed-info dt { color: var(--muted); }
.feed-info dd { margin: 0; }
.counts th { text-align: left; font-weight: normal; color: var(--muted); padding-right: 12px; }

.map-area { position: relative; min-height: 300px; }
.map-container { position: absolute; inset: 0; }
.map-notice { position: absolute; top: 12px; left: 12px; right: 12px; margin: 0; padding: 8px 12px; border-radius: 6px; background: var(--panel); border: 1px solid var(--border); }
.map-tooltip { position: absolute; pointer-events: none; padding: 2px 6px; border-radius: 4px; background: rgba(15, 23, 42, 0.85); color: #fff; font-size: 0.8rem; }
.fake-map { position: absolute; inset: 0; overflow: auto; padding: 8px; font-size: 0.8rem; }

.notice-page { max-width: 480px; margin: 15vh auto; padding: 0 16px; }

@media (max-width: 720px) {
  .app { grid-template-columns: 1fr; grid-template-rows: 50vh 50vh; }
  .sidebar { order: 2; border-right: none; border-top: 1px solid var(--border); }
}
```

- [ ] **Step 7: Remove template files**

```bash
git rm src/App.tsx src/App.css src/assets/hero.png src/assets/react.svg src/assets/vite.svg
```

- [ ] **Step 8: Type-check, lint, build, and smoke-test**

Run: `npx tsc -b && npm run lint && npx vitest run && npx vite build`
Expected: no errors; build output in `dist/` includes a separate worker chunk and a `sqlite3*.wasm` asset.

Smoke test in a real browser (the agent can skip if it cannot open a browser; Task 14 covers this automatically):

```bash
VITE_MAP_PROVIDER=fake npx vite
```

Generate a sample zip, then open the printed URL, upload it, and confirm the route list appears:

```bash
node --input-type=module -e "import {makeZip, SAMPLE_FEED} from './src/test-fixtures/sample-feed.ts'; import {writeFileSync} from 'node:fs'; writeFileSync(process.env.TMPDIR + '/demo-transit.zip', makeZip(SAMPLE_FEED));"
```

- [ ] **Step 9: Commit**

```bash
git add -A src index.html
git commit -m "feat: assemble explorer app with feed picker, import flow, and map view"
```

---

### Task 14: End-to-end tests

**Files:**
- Create: `playwright.config.ts`, `.env.e2e`, `e2e/helpers.ts`, `e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `SAMPLE_FEED`, `makeZip` (Task 5); UI accessible names (Tasks 12–13); fake map `data-state` (Task 11).

- [ ] **Step 1: Add configuration**

`.env.e2e`:

```
VITE_MAP_PROVIDER=fake
VITE_CATALOG_BASE_URL=https://catalog.test
```

`playwright.config.ts`:

```ts
import {defineConfig, devices} from '@playwright/test';

const PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure'},
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {
    command: `npx vite --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
  },
});
```

- [ ] **Step 2: Write `e2e/helpers.ts`**

```ts
import {expect, type BrowserContext, type Page} from '@playwright/test';
import {makeZip, SAMPLE_FEED} from '../src/test-fixtures/sample-feed.ts';

export const CATALOG_BASE = 'https://catalog.test';
const CORS = {'access-control-allow-origin': '*'};

export function sampleZip(): Buffer {
  return Buffer.from(makeZip(SAMPLE_FEED));
}

export interface MockCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly zip: Buffer;
}

/** Serves catalog.json, catalog.lock.json, and feed zips for the fake catalog origin. */
export async function mockCatalog(context: BrowserContext, entries: readonly MockCatalogEntry[]): Promise<void> {
  const catalog = entries.map((e) => ({
    id: e.id,
    name: e.name,
    region: e.region,
    sourceUrl: `https://agency.test/${e.id}.zip`,
  }));
  const lock = {
    generatedAt: '2026-10-09T00:00:00Z',
    feeds: Object.fromEntries(
      entries.map((e) => [
        e.id,
        {sha256: `sha-${e.id}`, size: e.zip.length, fetchedAt: '2026-10-09T00:00:00Z', lastError: null, lastErrorAt: null},
      ]),
    ),
  };
  await context.route(`${CATALOG_BASE}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/catalog.json') return route.fulfill({json: catalog, headers: CORS});
    if (path === '/catalog.lock.json') return route.fulfill({json: lock, headers: CORS});
    const entry = entries.find((e) => path === `/feeds/${e.id}.zip`);
    if (entry !== undefined) {
      return route.fulfill({body: entry.zip, contentType: 'application/zip', headers: CORS});
    }
    return route.fulfill({status: 404, headers: CORS});
  });
}

export async function uploadSample(page: Page): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({
    name: 'demo-transit.zip',
    mimeType: 'application/zip',
    buffer: sampleZip(),
  });
  await expect(page).toHaveURL(/feed=demo-transit/, {timeout: 30_000});
  await expect(page.locator('aside').getByRole('heading', {name: 'Routes'})).toBeVisible();
}

export interface FakeMapState {
  readonly filters: Record<string, unknown>;
  readonly opacity: Record<string, number>;
  readonly fitBoundsCount: number;
}

export async function fakeMapState(page: Page): Promise<FakeMapState> {
  const raw = await page.getByTestId('fake-map').getAttribute('data-state');
  return JSON.parse(raw ?? '{}');
}
```

- [ ] **Step 3: Write `e2e/explorer.spec.ts`**

```ts
import {expect, test} from '@playwright/test';
import {fakeMapState, mockCatalog, sampleZip, uploadSample} from './helpers.ts';

test.beforeEach(async ({context}) => {
  await mockCatalog(context, []);
});

test('imports an uploaded feed and highlights a selected route', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', {name: '10 · Airport - Central'}).click();
  await expect(page).toHaveURL(/route=R10/);
  await expect(sidebar.getByRole('heading', {name: '10 · Airport - Central'})).toBeVisible();
  await expect
    .poll(async () => (await fakeMapState(page)).filters['routes-highlight'])
    .toEqual({kind: 'eq', property: 'routeId', value: 'R10'});
  expect((await fakeMapState(page)).opacity['routes-line']).toBe(0.25);
});

test('selects a stop from the map and lists departures', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  await page.goto('/?feed=demo-transit&route=R10');
  await page.getByTestId('fake-map').locator('button[data-layer="stops-route"]', {hasText: 'Beatty Airport'}).click();
  await expect(page).toHaveURL(/stop=BEATTY/);
  await expect(page.locator('aside').getByRole('heading', {name: 'Beatty Airport'})).toBeVisible();
});

test('shows a station’s departures for a date and restores the view on reload', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  await page.goto('/?feed=demo-transit&stop=STN&date=2026-10-12');
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('heading', {name: 'Central Station'})).toBeVisible();
  const rows = sidebar.getByRole('table', {name: 'Departures'}).locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('08:20');
  await expect(rows.last()).toContainText('00:20 +1');

  await page.reload();
  await expect(sidebar.getByRole('heading', {name: 'Central Station'})).toBeVisible();
  await expect(rows).toHaveCount(4);
});

test('explains a blocked URL download and suggests uploading', async ({page, context}) => {
  await context.route('https://blocked.test/**', (route) => route.abort('failed'));
  await page.goto('/');
  await page.getByLabel('Feed URL').fill('https://blocked.test/feed.zip');
  await page.getByRole('button', {name: 'Import URL'}).click();
  await expect(page.getByRole('alert')).toContainText('upload it instead');
});

test('imports a feed from the catalog', async ({page, context}) => {
  await context.unrouteAll();
  await mockCatalog(context, [{id: 'demo-catalog', name: 'Demo Catalog Feed', region: 'Testland', zip: sampleZip()}]);
  await page.goto('/');
  await page.getByRole('button', {name: 'Import Demo Catalog Feed'}).click();
  await expect(page).toHaveURL(/feed=demo-catalog/, {timeout: 30_000});
  await page.getByRole('button', {name: 'Change feed'}).click();
  await expect(page.locator('.feed-list').getByRole('button', {name: 'Demo Catalog Feed'})).toBeVisible();
});

test('explains deep links to missing feeds and routes', async ({page}) => {
  await page.goto('/?feed=nope');
  await expect(page.getByRole('status')).toContainText("isn't saved in this browser");
  await expect(page).not.toHaveURL(/feed=/);

  await uploadSample(page);
  await page.goto('/?feed=demo-transit&route=NOPE');
  await expect(page.getByText('Route not found in this feed.')).toBeVisible();
});

test('a second tab can take over from the first', async ({context}) => {
  const first = await context.newPage();
  await first.goto('/');
  await expect(first.getByRole('heading', {name: 'Choose a feed'})).toBeVisible();

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText('already open in another tab')).toBeVisible();
  await second.getByRole('button', {name: 'Take over'}).click();
  await expect(second.getByRole('heading', {name: 'Choose a feed'})).toBeVisible({timeout: 15_000});
  await expect(first.getByText('opened in another tab')).toBeVisible();
});
```

- [ ] **Step 4: Run the E2E suite**

Run: `npm run e2e`
Expected: 7 passed.

If a test fails, debug with `npx playwright test --trace on` and `npx playwright show-trace`. Fix the application, not the assertion, unless the assertion contradicts the spec. Known risk: requests made by the dedicated worker (catalog zip, blocked URL) must be intercepted by `context.route`; Chromium routes dedicated-worker requests through the context. If they are not intercepted, the failing test will show a real network error to `catalog.test` — report that rather than weakening the test.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts .env.e2e e2e
git commit -m "test: add end-to-end tests for import, exploration, and tab handling"
```

---

### Task 15: Catalog mirror job, deployment docs, README

**Files:**
- Create: `scripts/mirror/mirror.ts`, `scripts/mirror/run.ts`, `catalog/catalog.json`, `.github/workflows/mirror-catalog.yml`, `docs/deploy.md`
- Modify: `README.md` (replace)
- Test: `scripts/mirror/mirror_test.ts`

**Interfaces:**
- Consumes: `parseCatalog`, `parseLock`, `feedZipKey`, `CATALOG_FILE`, `LOCK_FILE`, types (Task 10); `makeZip`, `SAMPLE_FEED` (Task 5, tests only).
- Produces:

```ts
export interface ObjectStore { put(key: string, body: Uint8Array, contentType: string): Promise<void>; getText(key: string): Promise<string | null> }
export interface MirrorDeps { readonly fetch: (url: string) => Promise<Response>; readonly store: ObjectStore; readonly now: () => Date; readonly log: (message: string) => void }
export interface MirrorReport { readonly lock: CatalogLock; readonly failures: readonly string[] }
export function checkGtfsZip(bytes: Uint8Array): string | null;
export function mirrorCatalog(catalog: readonly CatalogEntry[], deps: MirrorDeps): Promise<MirrorReport>;
```

- [ ] **Step 1: Write the failing tests**

`scripts/mirror/mirror_test.ts`:

```ts
import {strToU8} from 'fflate';
import {beforeEach, describe, expect, it} from 'vitest';
import type {CatalogEntry} from '../../src/catalog/catalog-types.ts';
import {makeZip, SAMPLE_FEED} from '../../src/test-fixtures/sample-feed.ts';
import {checkGtfsZip, mirrorCatalog, type ObjectStore} from './mirror.ts';

class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly puts: string[] = [];

  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
    this.puts.push(key);
  }

  async getText(key: string): Promise<string | null> {
    const body = this.objects.get(key);
    return body === undefined ? null : new TextDecoder().decode(body);
  }
}

const CATALOG: CatalogEntry[] = [
  {id: 'good', name: 'Good', region: 'A', sourceUrl: 'https://a.test/good.zip'},
  {id: 'bad', name: 'Bad', region: 'B', sourceUrl: 'https://b.test/bad.zip'},
];
const ZIP = makeZip(SAMPLE_FEED);

describe('mirrorCatalog', () => {
  let store: MemoryObjectStore;
  let responses: Record<string, () => Response>;

  beforeEach(() => {
    store = new MemoryObjectStore();
    responses = {
      'https://a.test/good.zip': () => new Response(ZIP),
      'https://b.test/bad.zip': () => new Response('nope', {status: 500}),
    };
  });

  const run = (catalog = CATALOG): ReturnType<typeof mirrorCatalog> =>
    mirrorCatalog(catalog, {
      fetch: async (url) => {
        const make = responses[url];
        if (make === undefined) throw new TypeError('fetch failed');
        return make();
      },
      store,
      now: () => new Date('2026-10-09T09:17:00Z'),
      log: () => {},
    });

  it('uploads good feeds, records failures, and writes catalog files', async () => {
    const report = await run();
    expect(report.failures).toEqual(['bad']);
    expect(report.lock.feeds['good']).toMatchObject({size: ZIP.length, lastError: null});
    expect(report.lock.feeds['good']?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.lock.feeds['bad']).toMatchObject({sha256: null, lastError: 'HTTP 500'});
    expect([...store.objects.keys()].sort()).toEqual(['catalog.json', 'catalog.lock.json', 'feeds/good.zip']);
  });

  it('keeps the previous mirror when a feed later fails', async () => {
    await run();
    responses['https://a.test/good.zip'] = () => new Response('down', {status: 503});
    const report = await run();
    expect(report.lock.feeds['good']).toMatchObject({size: ZIP.length, lastError: 'HTTP 503'});
    expect(report.lock.feeds['good']?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips re-uploading unchanged zips', async () => {
    await run();
    store.puts.length = 0;
    await run();
    expect(store.puts).not.toContain('feeds/good.zip');
  });

  it('rejects downloads that are not GTFS zips', async () => {
    responses['https://a.test/good.zip'] = () => new Response('<html>login</html>');
    const report = await run();
    expect(report.lock.feeds['good']?.lastError).toBe('not a valid zip archive');
  });
});

describe('checkGtfsZip', () => {
  it('requires a zip containing stops.txt', () => {
    expect(checkGtfsZip(ZIP)).toBeNull();
    expect(checkGtfsZip(makeZip({'readme.txt': 'hi'}))).toBe('zip does not contain stops.txt');
    expect(checkGtfsZip(strToU8('not a zip'))).toBe('not a valid zip archive');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts`
Expected: FAIL — cannot resolve `./mirror.ts`.

- [ ] **Step 3: Implement `scripts/mirror/mirror.ts`**

```ts
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {
  CATALOG_FILE,
  feedZipKey,
  LOCK_FILE,
  parseLock,
  type CatalogEntry,
  type CatalogLock,
  type CatalogLockEntry,
} from '../../src/catalog/catalog-types.ts';

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getText(key: string): Promise<string | null>;
}

export interface MirrorDeps {
  readonly fetch: (url: string) => Promise<Response>;
  readonly store: ObjectStore;
  readonly now: () => Date;
  readonly log: (message: string) => void;
}

export interface MirrorReport {
  readonly lock: CatalogLock;
  readonly failures: readonly string[];
}

/** Returns a problem description, or null if the bytes look like a GTFS zip. */
export function checkGtfsZip(bytes: Uint8Array): string | null {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    return 'not a valid zip archive';
  }
  return names.some((name) => name.split('/').at(-1) === 'stops.txt')
    ? null
    : 'zip does not contain stops.txt';
}

export async function mirrorCatalog(
  catalog: readonly CatalogEntry[],
  deps: MirrorDeps,
): Promise<MirrorReport> {
  const previousText = await deps.store.getText(LOCK_FILE);
  const previous = parseLock(previousText === null ? null : JSON.parse(previousText));
  const feeds: Record<string, CatalogLockEntry> = {};
  const failures: string[] = [];

  for (const entry of catalog) {
    const prior = previous.feeds[entry.id];
    const at = deps.now().toISOString();
    try {
      const response = await deps.fetch(entry.sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const problem = checkGtfsZip(bytes);
      if (problem !== null) throw new Error(problem);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const unchanged = prior?.sha256 === sha256;
      if (!unchanged) await deps.store.put(feedZipKey(entry.id), bytes, 'application/zip');
      feeds[entry.id] = {sha256, size: bytes.length, fetchedAt: at, lastError: null, lastErrorAt: null};
      deps.log(`${entry.id}: ok (${bytes.length} bytes${unchanged ? ', unchanged' : ''})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(entry.id);
      feeds[entry.id] = {
        sha256: prior?.sha256 ?? null,
        size: prior?.size ?? null,
        fetchedAt: prior?.fetchedAt ?? null,
        lastError: message,
        lastErrorAt: at,
      };
      deps.log(`${entry.id}: FAILED — ${message}`);
    }
  }

  const lock: CatalogLock = {generatedAt: deps.now().toISOString(), feeds};
  const encoder = new TextEncoder();
  await deps.store.put(CATALOG_FILE, encoder.encode(JSON.stringify(catalog, null, 2)), 'application/json');
  await deps.store.put(LOCK_FILE, encoder.encode(JSON.stringify(lock, null, 2)), 'application/json');
  return {lock, failures};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts`
Expected: PASS.

- [ ] **Step 5: Implement the runner, catalog, and workflow**

`scripts/mirror/run.ts`:

```ts
import {readFile} from 'node:fs/promises';
import {GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {parseCatalog} from '../../src/catalog/catalog-types.ts';
import {mirrorCatalog, type ObjectStore} from './mirror.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function r2Store(): ObjectStore {
  const bucket = requireEnv('R2_BUCKET');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=300',
        }),
      );
    },
    async getText(key) {
      try {
        const object = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
        return (await object.Body?.transformToString()) ?? null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
  };
}

const catalogPath = new URL('../../catalog/catalog.json', import.meta.url);
const catalog = parseCatalog(JSON.parse(await readFile(catalogPath, 'utf8')));
const report = await mirrorCatalog(catalog, {
  fetch: (url) => fetch(url),
  store: r2Store(),
  now: () => new Date(),
  log: (message) => console.log(message),
});
if (report.failures.length > 0) {
  console.error(`Failed to mirror: ${report.failures.join(', ')}`);
  process.exitCode = 1;
}
```

`catalog/catalog.json` (an example entry; the author edits this list):

```json
[
  {
    "id": "mbta",
    "name": "MBTA",
    "region": "Boston, MA",
    "sourceUrl": "https://cdn.mbta.com/MBTA_GTFS.zip"
  }
]
```

`.github/workflows/mirror-catalog.yml`:

```yaml
name: Mirror catalog feeds

on:
  schedule:
    - cron: '17 9 * * *'
  workflow_dispatch:

jobs:
  mirror:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run mirror
        env:
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
```

- [ ] **Step 6: Write `docs/deploy.md`**

````markdown
# Deploying GTFS Visualizer

The app is static files on Cloudflare Pages. Catalog feeds are mirrored nightly into a Cloudflare R2 bucket by a GitHub Action.

## 1. R2 bucket

1. Create a bucket (e.g. `gtfs-visualizer-feeds`).
2. Make it publicly readable through a custom domain (e.g. `feeds.example.com`) or the bucket's `r2.dev` URL. This URL is `VITE_CATALOG_BASE_URL`.
3. Add this CORS policy (Bucket → Settings → CORS), replacing the Pages domain:

```json
[
  {
    "AllowedOrigins": ["https://gtfs-visualizer.pages.dev", "http://localhost:5173"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Create an R2 API token with Object Read & Write on this bucket.

## 2. GitHub secrets

Add repository secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Run the "Mirror catalog feeds" workflow once by hand (Actions → Run workflow) to populate the bucket.

## 3. Mapbox token

Create a public token in your Mapbox account with **URL restrictions** set to the production domain (and `http://localhost:5173` for development if you like). Public tokens are visible to anyone using the site; the URL restriction is what limits abuse.

## 4. Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_MAPBOX_TOKEN`, `VITE_CATALOG_BASE_URL`
- No special headers are needed (the app does not use COOP/COEP).

## Maintaining the catalog

Edit `catalog/catalog.json`. Each entry needs a unique `id` (lowercase letters, digits, dashes), a `name`, a `region`, and the agency's `sourceUrl`. Commit and run the workflow (or wait for the nightly run). A feed that fails to download keeps its last good copy; the failure is recorded in `catalog.lock.json` and the workflow run is marked failed.
````

- [ ] **Step 7: Replace `README.md`**

```markdown
# GTFS Visualizer

Explore public-transit GTFS feeds in the browser. Feeds are imported into SQLite databases stored in your browser (OPFS) — nothing is uploaded anywhere.

## Development

```bash
npm install
cp .env.example .env   # add a Mapbox token
npm run dev
```

Without a Mapbox token, run `VITE_MAP_PROVIDER=fake npm run dev` to use a text-only stand-in map.

## Tests

- `npm test` — unit and integration tests (Vitest, sqlite-wasm in Node)
- `npm run e2e` — end-to-end tests (Playwright, Chromium)
- `npm run perf -- path/to/feed.zip` — import timing for a real feed

## Deployment

See [docs/deploy.md](docs/deploy.md). Design: [docs/superpowers/specs/2026-10-09-feed-import-and-explorer-design.md](docs/superpowers/specs/2026-10-09-feed-import-and-explorer-design.md).
```

- [ ] **Step 8: Type-check and commit**

Run: `npx tsc -b && npx vitest run`
Expected: no errors; all tests PASS.

```bash
git add scripts/mirror catalog .github docs/deploy.md README.md
git commit -m "feat: add nightly catalog mirror to R2 and deployment docs"
```

---

### Task 16: Performance baseline

**Files:**
- Create: `scripts/perf-import.ts`, `docs/perf-baseline.md`

**Interfaces:**
- Consumes: `loadSqlite`, `createGtfsTables`, `IssueCollector`, `loadGtfsZip`, `buildDerivedTables` (Tasks 4–6).

- [ ] **Step 1: Implement `scripts/perf-import.ts`**

```ts
import {openAsBlob} from 'node:fs';
import {createGtfsTables} from '../src/worker/ddl.ts';
import {buildDerivedTables} from '../src/worker/derive.ts';
import {IssueCollector} from '../src/worker/issues.ts';
import {loadGtfsZip} from '../src/worker/loader.ts';
import {loadSqlite} from '../src/worker/sqlite.ts';

const path = process.argv[2];
if (path === undefined) {
  console.error('Usage: npm run perf -- <path/to/feed.zip>');
  process.exit(2);
}

const blob = await openAsBlob(path);
const sqlite3 = await loadSqlite();
const db = new sqlite3.oo1.DB(':memory:');
db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;');
createGtfsTables(db);
const issues = new IssueCollector(db);

const started = performance.now();
const result = await loadGtfsZip(db, blob.stream(), issues, {bytesTotal: blob.size});
const loaded = performance.now();
if (result.fatal) {
  console.error(issues.fatalIssues().map((issue) => issue.message).join('\n'));
  process.exit(1);
}
buildDerivedTables(db, issues);
issues.finish();
const derived = performance.now();

const pageCount = Number(db.selectValue('PRAGMA page_count'));
const pageSize = Number(db.selectValue('PRAGMA page_size'));
console.table({
  zipMB: (blob.size / 1e6).toFixed(1),
  stopTimes: Number(db.selectValue('SELECT count(*) FROM stop_times')),
  loadAndIndexSeconds: ((loaded - started) / 1000).toFixed(1),
  deriveSeconds: ((derived - loaded) / 1000).toFixed(1),
  totalSeconds: ((derived - started) / 1000).toFixed(1),
  dbMB: ((pageCount * pageSize) / 1e6).toFixed(1),
  issues: issues.totalCount(),
});
```

- [ ] **Step 2: Run against a large real feed**

The spec suggests a 511 SF Bay–sized regional feed; 511 requires an API key, so use the MBTA feed (similar scale, public):

```bash
mkdir -p "$TMPDIR/gtfs-perf" && curl -L -o "$TMPDIR/gtfs-perf/mbta.zip" https://cdn.mbta.com/MBTA_GTFS.zip
npm run perf -- "$TMPDIR/gtfs-perf/mbta.zip"
```

Expected: a table of timings, no fatal issues. Also import the same zip in the dev app (`npm run dev`, upload) in Chrome and time it with a stopwatch from the file chooser closing to the route list appearing.

- [ ] **Step 3: Record the results in `docs/perf-baseline.md`**

Write the file using the numbers you measured, in this shape:

```markdown
# Import performance baseline

Measured on <date> on <machine / CPU / RAM>, Node <version>, Chrome <version>.

| Feed | Zip size | stop_times rows | Node load+index | Node derive | Node total | DB size | Browser (OPFS) total |
|------|----------|-----------------|-----------------|-------------|------------|---------|----------------------|
| MBTA (<feed_version>) | … MB | … | … s | … s | … s | … MB | … s |

Notes: <anything surprising, e.g. which stage dominated>
```

If the browser import of this feed takes more than ~2 minutes or the tab runs out of memory, note it in the file and tell your human partner — that is a finding for the next spec, not something to fix in this task.

- [ ] **Step 4: Commit**

```bash
git add scripts/perf-import.ts docs/perf-baseline.md
git commit -m "chore: add import performance script and baseline"
```
