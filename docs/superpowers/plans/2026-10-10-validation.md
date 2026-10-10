# Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the open feed with a curated rule set in the worker, store results per feed with a rule-set version, and show them as a report view and inline in route and stop detail.

**Architecture:** Six checks (each owning one or more rule ids) run in sequence in the worker against the current feed DB, yielding a macrotask between checks and between chunks of heavy checks so explorer queries interleave. Issues are buffered in memory (≤ 200 stored per rule) and written in one transaction at the end, tagged with `RULESET_VERSION`. `FeedService.ensureValidation` runs or joins a run; `closeCurrent()` cancels it. The UI calls `ensureValidation` when a feed opens and reads results through `getValidationSummary` / `getValidationIssues` / `getImportIssues`.

**Tech Stack:** TypeScript, `@sqlite.org/sqlite-wasm` (oo1 API), Comlink, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-validation-design.md`

## Global Constraints

- Google TypeScript style: semicolons, single quotes, named exports only, no `any`, no non-null `!`, explicit return types on exports, kebab-case file names.
- `erasableSyntaxOnly`: no enums, parameter properties, or namespaces.
- Relative imports include the `.ts`/`.tsx` extension.
- UI code imports from `src/worker` with `import type` only; shared types and constants live in `src/shared/`.
- `src/test-fixtures/sample-feed.ts` depends only on `fflate`.
- Unit tests are `*_test.ts` next to the code; E2E specs are `e2e/*.spec.ts`.
- oxlint suppressions name the rule and carry a one-line justification.
- Severities: `error` | `warning` | `info` (import keeps `fatal`).
- Stored issue cap: **200 rows per rule**; `total` keeps the true count.
- `RULESET_VERSION = 1`; any change to rules, thresholds, or messages bumps it.
- Thresholds: speed spans under **200 m** skipped; speed limits km/h — bus, tram, subway, trolleybus, monorail, other **150**; rail **500**; ferry **80**; cable, aerial, funicular **50**. Stop far from shape: **> 100 m**. Near-duplicate stops: **< 2 m**. Color contrast: **< 3:1**.
- Performance target on MBTA in Node: full run **< ~10 s**; no stretch between checkpoints **> ~250 ms**.

## Deviations from the spec (update the spec in Task 1)

1. **No `_next` tables.** Each rule stores ≤ 200 rows, so a run buffers results in memory and writes them in one transaction (`writeValidationResults`) after the last check. Atomicity comes from the transaction; an interrupted run writes nothing, so there is nothing to clean up.
2. **Checks own rules.** `ValidationCheck = {ruleIds, run}` instead of one module per rule, so one scan of `stop_times` serves four rules. Progress is `{checkIndex, checkCount}` (6 checks). A check that throws marks all its rule ids failed and its issues are discarded.
3. **File layout:** `rules/{references,stop-times,patterns,coverage,stops,feed}.ts` plus `rules/index.ts`, `store.ts`, `names.ts`.
4. **`VALID_FEED` fixture:** `SAMPLE_FEED` genuinely has defects (route R30 has no trips; R10 buses run ~200 km/h) and many existing tests depend on it, so it stays as the "has issues" feed. The zero-issues test and the E2E "No issues found" case use a new `VALID_FEED`.
5. **Issue names:** `ValidationIssue` carries `routeName` / `stopName` from a join at read time (null when the referenced route/stop doesn't exist), so the report can label buttons and hide buttons to missing entities.
6. **Import notes:** the report expands an import-issue code through a new `getImportIssues(feedId, code)`.

## Review Focus

- **Switching feeds while a run is in progress** — the run must stop without touching the closed DB, and the new feed must validate. Test in Task 9.
- **Feeds imported before validation existed** (no validation tables) — summary returns null, issue queries return `[]`, no throw. Test in Task 2.
- **Stops with missing coordinates on a pattern** — geometry checks must skip them, not emit NaN distances or speeds. Test in Task 6.
- **Untimed intermediate stops and minute-rounded equal times** — must merge into one span, never infinite speed. Test in Task 6.
- **Issue pointing at a route or stop that doesn't exist** (e.g. `trip_unknown_route`) — no "Open route" button that leads to "Route not found". Test in Task 2 (null `routeName`) and Task 11 (no button).

---

### Task 1: Shared validation types, fixture, and spec update

**Files:**
- Create: `src/shared/validation.ts`
- Create: `src/shared/validation_test.ts`
- Modify: `src/test-fixtures/sample-feed.ts` (append `VALID_FEED`)
- Modify: `docs/superpowers/specs/2026-10-10-validation-design.md` (apply the deviations above to §3, §4.1, §4.2, §4.4, §6, §7)

**Interfaces:**
- Produces (all exported from `src/shared/validation.ts`):

```ts
export const RULESET_VERSION = 1;
export const STORED_ISSUE_CAP = 200;
export type ValidationSeverity = 'error' | 'warning' | 'info';
export type RuleId =
  | 'trip_unknown_route' | 'trip_unknown_service' | 'trip_unknown_shape' | 'stop_unknown_parent'
  | 'stop_time_unknown_trip' | 'stop_time_unknown_stop' | 'stop_times_out_of_order' | 'trip_too_few_stops'
  | 'unrealistic_speed' | 'stop_far_from_shape'
  | 'route_without_trips' | 'stop_unused' | 'service_never_active'
  | 'stop_invalid_coords' | 'stops_near_duplicate'
  | 'feed_expired' | 'feed_not_yet_active' | 'route_color_contrast';
export interface RuleInfo {readonly severity: ValidationSeverity; readonly title: string; readonly description: string}
export const RULES: Readonly<Record<RuleId, RuleInfo>>;
export const RULE_IDS: readonly RuleId[]; // the union's order above
export type IssueDetails = Readonly<Record<string, string | number>>;
export interface ValidationIssue {
  readonly ruleId: RuleId; readonly severity: ValidationSeverity;
  readonly routeId: string | null; readonly routeName: string | null;
  readonly stopId: string | null; readonly stopName: string | null;
  readonly tripId: string | null; readonly message: string; readonly details: IssueDetails | null;
}
export type ValidationFilter = {readonly ruleId: RuleId} | {readonly routeId: string} | {readonly stopId: string};
export interface ValidationProgress {readonly checkIndex: number; readonly checkCount: number}
export interface ValidationCounts {readonly error: number; readonly warning: number; readonly info: number}
export type ValidationStatus =
  | {readonly state: 'current'; readonly counts: ValidationCounts}
  | {readonly state: 'cancelled'}
  | {readonly state: 'failed'; readonly message: string};
export interface RuleResult {
  readonly ruleId: RuleId; readonly severity: ValidationSeverity;
  readonly total: number; readonly stored: number; readonly errorMessage: string | null;
}
export interface ImportIssueGroup {readonly code: IssueCode; readonly severity: IssueSeverity; readonly count: number}
export interface ValidationSummary {
  readonly counts: ValidationCounts;
  readonly rules: readonly RuleResult[]; // only rules with total > 0 or errorMessage !== null, in RULE_IDS order
  readonly importIssues: readonly ImportIssueGroup[];
}
/** "3 errors · 12 warnings · 4 info"; zero counts omitted; "" when all zero. */
export function formatCounts(counts: ValidationCounts): string;
```

- Produces `VALID_FEED: Readonly<Record<string, string>>` in `sample-feed.ts`.

`RULES` copy (severity · title · description):

| Rule | Sev | Title | Description |
|---|---|---|---|
| `trip_unknown_route` | error | Trip refers to a missing route | The trip's route_id isn't in routes.txt, so the trip is not shown. |
| `trip_unknown_service` | error | Trip refers to a missing service | The trip's service_id isn't in calendar.txt or calendar_dates.txt, so it never runs. |
| `trip_unknown_shape` | warning | Trip refers to a missing shape | The shape has no points, so the line is drawn straight between stops. |
| `stop_unknown_parent` | error | Stop has an invalid parent station | The parent_station is missing or is the wrong kind of location. |
| `stop_time_unknown_trip` | error | Stop times for a missing trip | stop_times.txt lists a trip that isn't in trips.txt. |
| `stop_time_unknown_stop` | error | Stop time at a missing stop | A trip stops at a stop that isn't in stops.txt. |
| `stop_times_out_of_order` | error | Times go backwards | A trip arrives at a stop earlier than it left the previous one. |
| `trip_too_few_stops` | error | Trip has fewer than two stops | A trip needs at least two stop times to go anywhere. |
| `unrealistic_speed` | warning | Unrealistic speed | A vehicle would have to travel faster than is plausible for its mode. |
| `stop_far_from_shape` | warning | Stop far from the route's line | The stop is more than 100 m from the shape its trips follow. |
| `route_without_trips` | warning | Route has no trips | The route is listed but nothing runs on it. |
| `stop_unused` | warning | Stop not served | No trip stops here. |
| `service_never_active` | warning | Service never runs | The service's calendar and exceptions leave no dates on which it runs. |
| `stop_invalid_coords` | error | Stop has invalid coordinates | Coordinates are missing, out of range, or exactly 0,0. |
| `stops_near_duplicate` | info | Possible duplicate stops | Two stops with the same name are less than 2 m apart. |
| `feed_expired` | warning | Feed has expired | Service in this feed has ended. |
| `feed_not_yet_active` | warning | Feed not yet active | Service in this feed hasn't started yet. |
| `route_color_contrast` | info | Low contrast route colors | The route's text color is hard to read on its route color. |

`VALID_FEED` = `SAMPLE_FEED` with:
- `trips.txt` plus row `R30,WKDY,T30_1,Central,0,`
- `stop_times.txt`: T10_1 `08:00 / blank / 09:00`; T10_2 `23:50 / 24:05 / 25:05`; T10_3 `09:00 / 09:50 / 10:00`; plus `T30_1,14:00:00,14:00:00,FUR,1` and `T30_1,16:00:00,16:00:00,STN_A,2`. T20 rows unchanged.
- `calendar.txt` end dates `20991231` (so it never expires during E2E).

- [ ] **Step 1: Write the failing test** `src/shared/validation_test.ts`

```ts
describe('formatCounts', () => {
  it('omits zero counts and pluralizes', () => {
    expect(formatCounts({error: 1, warning: 12, info: 4})).toBe('1 error · 12 warnings · 4 info');
    expect(formatCounts({error: 0, warning: 1, info: 0})).toBe('1 warning');
    expect(formatCounts({error: 0, warning: 0, info: 0})).toBe('');
  });
});
describe('RULES', () => {
  it('covers every rule id once', () => {
    expect(new Set(RULE_IDS).size).toBe(18);
    expect(Object.keys(RULES).sort()).toEqual([...RULE_IDS].sort());
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/shared/validation_test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/shared/validation.ts` as specified (imports `IssueCode`, `IssueSeverity` with `import type` from `./types.ts`), and add `VALID_FEED` to `sample-feed.ts` using `withFile`-style spreading.
- [ ] **Step 4: Run** `npx vitest run src/shared/validation_test.ts` and `npx tsc -b` — Expected: PASS, no type errors.
- [ ] **Step 5: Update the spec** with deviations 1–6 (replace the `_next` description in §3 and §6, the file table in §4.1, the interface in §4.2, the progress type in §4.4, and the fixture note in §7).
- [ ] **Step 6: Commit**

```bash
git add src/shared/validation.ts src/shared/validation_test.ts src/test-fixtures/sample-feed.ts docs/superpowers/specs/2026-10-10-validation-design.md
git commit -m "feat: shared validation types and a valid sample feed"
```

---

### Task 2: Geometry helpers, runner, and result store

**Files:**
- Create: `src/worker/validation/geo.ts`, `geo_test.ts`
- Create: `src/worker/validation/runner.ts`, `runner_test.ts`
- Create: `src/worker/validation/store.ts`, `store_test.ts`
- Create: `src/worker/validation/names.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:

```ts
// geo.ts
export type LonLat = readonly [number, number];
export function haversineMeters(a: LonLat, b: LonLat): number; // R = 6_371_000
/** Min distance from `point` to the polyline, via an equirectangular projection centered on `point`. One-point line → distance to that point. */
export function distanceToPolylineMeters(point: LonLat, line: readonly LonLat[]): number;

// runner.ts
export interface EmittedIssue {
  readonly routeId?: string | null; readonly stopId?: string | null; readonly tripId?: string | null;
  readonly message: string; readonly details?: IssueDetails;
}
export interface CheckContext {
  readonly db: Database;
  readonly today: string; // YYYYMMDD in feed timezone
  emit(ruleId: RuleId, issue: EmittedIssue): void; // throws if ruleId not in the check's ruleIds
  checkpoint(): Promise<void>; // setTimeout(0), then throws ValidationCancelled if token.cancelled
}
export interface ValidationCheck {readonly ruleIds: readonly RuleId[]; run(ctx: CheckContext): Promise<void>}
export interface CancelToken {cancelled: boolean}
export class ValidationCancelled extends Error {}
export interface RunOptions {
  readonly now: Date;
  readonly token: CancelToken;
  readonly checks: readonly ValidationCheck[];
  readonly onProgress?: (progress: ValidationProgress) => void;
}
export async function runValidation(db: Database, options: RunOptions): Promise<ValidationStatus>;

// store.ts
export interface RuleBuffer {readonly ruleId: RuleId; readonly total: number; readonly issues: readonly EmittedIssue[]; readonly errorMessage: string | null}
export function writeValidationResults(db: Database, buffers: readonly RuleBuffer[], completedAt: string): void;
/** Counts when stored results match RULESET_VERSION; null when tables are missing or outdated. */
export function getCurrentCounts(db: Database): ValidationCounts | null;
export function getValidationSummary(db: Database): ValidationSummary | null;
export function getValidationIssues(db: Database, filter: ValidationFilter): ValidationIssue[];
export function getImportIssues(db: Database, code: IssueCode): ImportIssue[];

// names.ts — lazy lookups shared by checks for message text
export interface Names {stop(id: string): string; route(id: string): string} // stop_name ?? id; short ?? long ?? id
export function createNames(db: Database): Names;
```

Runner behavior: computes `today` with `todayInTimeZone(<feed_summary 'timezone' or null>, now)`; for each check, calls `onProgress({checkIndex, checkCount})`, runs it with a context whose `emit` appends to per-rule buffers (count every emit, store the first `STORED_ISSUE_CAP`), and awaits `checkpoint()` after it. A non-cancel throw sets `errorMessage` (the error's message) on all the check's rule ids and empties their buffers. `ValidationCancelled` → return `{state: 'cancelled'}` without touching `db` again. After all checks: `writeValidationResults(db, buffers, now.toISOString())`; if that throws, return `{state: 'failed', message}`; else `{state: 'current', counts}`.

Store behavior: `writeValidationResults` creates the three tables and indexes from spec §3 with `IF NOT EXISTS` (`validation_rules` without the `_next` variant), then in one `BEGIN … COMMIT` (with `ROLLBACK` on error, rethrow) deletes all rows, inserts rule rows (severity from `RULES`) and issue rows, and upserts `validation_meta` keys `ruleset_version` and `completed_at`. Reads: `getCurrentCounts` sums `validation_rules.total` by severity. `getValidationIssues` orders by severity rank (error, warning, info), then `rule_id`, then `rowid`; `routeName` = `COALESCE(r.route_short_name, r.route_long_name, r.route_id)` via LEFT JOIN (null if no such route); `stopName` = `COALESCE(s.stop_name, s.stop_id)` likewise. `{stopId}` matches `stop_id = ?` or a stop whose `parent_station = ?`. `getImportIssues` returns stored rows for that code (excluding `suppressed` from the summary groups only).

- [ ] **Step 1: Write failing tests**

`geo_test.ts`:
```ts
expect(haversineMeters([0, 0], [0, 1])).toBeCloseTo(111_195, 0);
expect(distanceToPolylineMeters([0.5, 0.001], [[0, 0], [1, 0]])).toBeCloseTo(111.2, 0);
expect(distanceToPolylineMeters([2, 0], [[0, 0], [1, 0]])).toBeCloseTo(111_195, -2); // beyond the endpoint
expect(distanceToPolylineMeters([0, 1], [[0, 0]])).toBeCloseTo(111_195, 0); // one-point line
```

`runner_test.ts` (use `loadSampleDb()` and inline fake checks):
- `it('stores at most 200 issues per rule but counts all')` — a check emitting 250 `stop_unused` issues → summary rule `{total: 250, stored: 200}`, `getValidationIssues(db, {ruleId: 'stop_unused'})` length 200.
- `it('records a throwing check and keeps running the others')` — check A (`ruleIds: ['stop_unused', 'route_without_trips']`) emits then throws `new Error('boom')`; check B emits one `feed_expired` → status `current`, counts `{error: 0, warning: 1, info: 0}`, summary has both A rules with `errorMessage: 'boom', total: 0`.
- `it('rejects emits for rule ids the check does not own')` — check with `ruleIds: ['stop_unused']` emitting `feed_expired` → that check's rules get an errorMessage.
- `it('leaves previous results when cancelled')` — run once with one issue; second run whose check sets `token.cancelled = true` then calls `checkpoint()` → status `cancelled`; previous issue still returned.
- `it('reports progress per check')` — two checks → `onProgress` calls `[{checkIndex: 0, checkCount: 2}, {checkIndex: 1, checkCount: 2}]`.
- `it('passes today in the feed time zone')` — `now = new Date('2026-10-10T05:00:00Z')`, sample feed is America/Los_Angeles → check sees `ctx.today === '20261009'`.

`store_test.ts`:
- `it('returns null and empty lists before any run')` — fresh `loadSampleDb()` → `getCurrentCounts` null, `getValidationSummary` null, `getValidationIssues(db, {routeId: 'R10'})` `[]`.
- `it('treats results from another ruleset version as outdated')` — write, then `UPDATE validation_meta SET value = '0' WHERE key = 'ruleset_version'` → `getCurrentCounts` null.
- `it('filters by route, by stop, and by station including children')` — write issues on stop `STN_A` and route `R10`; `{stopId: 'STN'}` returns the STN_A issue.
- `it('names linked entities and leaves missing ones null')` — issue with `routeId: 'NOPE'` → `routeName: null`; `routeId: 'R10'` → `routeName: '10'`; `stopId: 'STN_A'` → `stopName: 'Central Station Platform A'`.
- `it('groups import issues by code')` — `loadSampleDb(withFile('stops.txt', …a row with stop_lat 'abc'…))` then write empty results → summary `importIssues` contains `{code: 'invalid_value', severity: <as recorded>, count: 1}`; `getImportIssues(db, 'invalid_value')` length 1.

- [ ] **Step 2: Run** `npx vitest run src/worker/validation` — Expected: FAIL (modules not found).
- [ ] **Step 3: Implement** `geo.ts`, `names.ts`, `store.ts`, `runner.ts` per the interfaces above.
- [ ] **Step 4: Run** `npx vitest run src/worker/validation` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: validation runner, result store, and geometry helpers"`

---

### Task 3: References check

**Files:**
- Create: `src/worker/validation/rules/references.ts`, `references_test.ts`

**Interfaces:**
- Consumes: `ValidationCheck`, `CheckContext`, `createNames` (Task 2).
- Produces: `export const referencesCheck: ValidationCheck` with `ruleIds: ['trip_unknown_route', 'trip_unknown_service', 'trip_unknown_shape', 'stop_unknown_parent']`.

SQL anti-joins over `trips` / `stops`. Expected parent type: location types 0 (or null), 2, 3 need a parent with `location_type = 1`; type 4 needs a parent with `location_type` 0 or null. Stops without `parent_station` are skipped. Messages (exact):
- `Trip ${tripId} refers to route ${routeId}, which isn't in routes.txt.` (links trip only)
- `Trip ${tripId} uses service ${serviceId}, which isn't in calendar.txt or calendar_dates.txt, so it never runs.` (route, trip)
- `Trip ${tripId} uses shape ${shapeId}, which has no points in shapes.txt; its line is drawn from stop positions.` (route, trip)
- `${stopName} has parent station ${parentId}, which isn't in stops.txt.` / `…, which isn't a station.` / `…, which isn't a platform.` (stop)

Test helper used by Tasks 3–7 (put it in `references_test.ts`' sibling `src/worker/validation/rules/test-helpers.ts`):

```ts
export async function runCheck(check: ValidationCheck, files?: Readonly<Record<string, string>>, now?: Date): Promise<ValidationIssue[]>;
// loadSampleDb(files) → runValidation(db, {now: now ?? new Date('2026-10-10T12:00:00Z'), token: {cancelled: false}, checks: [check]})
// → for each rule id in the check, getValidationIssues(db, {ruleId}); concatenated
```

- [ ] **Step 1: Write failing tests** (each uses `withFile` on `VALID_FEED` — add `withValidFile(name, text)` to `test-helpers.ts`):
  - `it('finds nothing in the valid feed')` → `runCheck(referencesCheck, VALID_FEED)` is `[]`.
  - `it('flags a trip with an unknown route')` — add trip `NOPE,WKDY,TX,…` → one issue `{ruleId: 'trip_unknown_route', tripId: 'TX', routeId: null}`.
  - `it('flags a trip with an unknown service')` — trip `R10,GHOST,TX,…` → `{routeId: 'R10', tripId: 'TX'}`.
  - `it('flags a shape with no points')` — trip `R20,WKDY,TX,…,NOSHAPE` → `trip_unknown_shape`, severity `warning`.
  - `it('flags a platform whose parent is not a station')` — `STN_A`'s parent changed to `FUR` → message ends `which isn't a station.`, `stopId: 'STN_A'`.
- [ ] **Step 2: Run** `npx vitest run src/worker/validation/rules/references_test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `referencesCheck` and `test-helpers.ts`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: validation check for broken references"`

---

### Task 4: Stop-times check

**Files:**
- Create: `src/worker/validation/rules/stop-times.ts`, `stop-times_test.ts`

**Interfaces:**
- Produces: `export const stopTimesCheck: ValidationCheck` with `ruleIds: ['stop_time_unknown_trip', 'stop_time_unknown_stop', 'stop_times_out_of_order', 'trip_too_few_stops']`; and `export const TRIP_BATCH = 2000`.

Algorithm: load `Map<tripId, routeId | null>` from `trips` and `Set<stopId>` from `stops`. Loop: `SELECT DISTINCT trip_id FROM stop_times WHERE trip_id > ? ORDER BY trip_id LIMIT 2000` (cursor starts at `''`); stop when empty; then `SELECT trip_id, stop_id, stop_sequence, arrival_secs, departure_secs FROM stop_times WHERE trip_id > ? AND trip_id <= ? ORDER BY trip_id, stop_sequence`; process trip by trip; `await ctx.checkpoint()` after each batch. Per trip:
- not in trips map → one `stop_time_unknown_trip` per trip: `stop_times.txt lists trip ${tripId}, which isn't in trips.txt.` (details `{tripId}`, no links).
- each stop id not in the set → one `stop_time_unknown_stop` per (trip, stop): `Trip ${tripId} stops at ${stopId}, which isn't in stops.txt.` (route, trip).
- order: track `last` = the latest known time (departure, else arrival) of previous stops. A stop whose arrival (else departure) `< last`, or whose `departure < arrival`, → first such stop only: `Trip ${tripId} goes back in time at ${stopName} (stop ${stopSequence}).` (route, trip, stop; details `{stopSequence}`). Null times are skipped.
- fewer than 2 rows → `Trip ${tripId} has ${n} stop time${n === 1 ? '' : 's'}; a trip needs at least 2.` (route, trip).
After the loop, trips in `trips` with no `stop_times` rows emit `trip_too_few_stops` with n = 0.

- [ ] **Step 1: Write failing tests**
  - `it('finds nothing in the valid feed')`.
  - `it('flags a time earlier than the previous stop')` — T20_1 second stop at `09:00:00` → one issue, `stopId: 'FUR'`, `details: {stopSequence: 2}`.
  - `it('ignores untimed stops when ordering')` — valid feed's T10_1 middle stop is blank → no issue (covered by the first test; assert explicitly on T10_1).
  - `it('flags departure before arrival')` — T20_1 first row `10:00:00,09:59:00` → issue at `STN_A`.
  - `it('flags trips with one or zero stop times')` — add trip `TX` with one row, and trip `TY` with none → messages `Trip TX has 1 stop time; …` and `Trip TY has 0 stop times; …`.
  - `it('flags stop times for unknown trips and stops')`.
  - `it('scans across batch boundaries')` — call with `TRIP_BATCH` behavior by adding 2,001 one-stop trips programmatically to the files → exactly 2,001 `trip_too_few_stops` totals (via summary `total`).
- [ ] **Step 2: Run** `npx vitest run src/worker/validation/rules/stop-times_test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `stopTimesCheck`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: validation check for stop times"`

---

### Task 5: Coverage check

**Files:**
- Create: `src/worker/validation/rules/coverage.ts`, `coverage_test.ts`

**Interfaces:**
- Produces: `export const coverageCheck: ValidationCheck` with `ruleIds: ['route_without_trips', 'stop_unused', 'service_never_active']`.

- `route_without_trips`: routes with no `route_patterns` row → `Route ${label} has no trips.` (route).
- `stop_unused`: stops with `COALESCE(location_type, 0) IN (0, 1)` not in `stop_routes` → `${stopName} isn't served by any trip.` (stop).
- `service_never_active`: for each service id in `calendar` ∪ `calendar_dates`: active if any `exception_type = 1` row exists, or some date in its calendar range has its weekday flag set and isn't removed by an `exception_type = 2` row (iterate with `addDays` / `weekdayOf` from `src/gtfs/time.ts`, stop at the first active date). For each never-active service, one issue per route using it: `Service ${serviceId} never runs, so route ${label}'s trips that use it never run.` (route; details `{serviceId}`).

- [ ] **Step 1: Write failing tests**
  - `it('finds nothing in the valid feed')`.
  - `it('flags a route with no trips')` — `runCheck(coverageCheck, SAMPLE_FEED)` → `[{ruleId: 'route_without_trips', routeId: 'R30', message: 'Route 30 has no trips.'}]` (match with `toMatchObject`).
  - `it('flags a stop no trip serves')` — add stop `LONELY` → `stop_unused` with `stopId: 'LONELY'`; the parent station `STN` (served through STN_A) is not flagged.
  - `it('flags a service whose calendar has no running days')` — WKND row with all weekday flags 0 and no added dates → issue for route R20.
  - `it('treats a service with only added dates as active')`.
- [ ] **Step 2: Run** `npx vitest run src/worker/validation/rules/coverage_test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `coverageCheck`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: validation check for unused routes, stops, and services"`

---

### Task 6: Patterns check (speed and distance from shape)

**Files:**
- Create: `src/worker/validation/rules/patterns.ts`, `patterns_test.ts`

**Interfaces:**
- Consumes: `haversineMeters`, `distanceToPolylineMeters`, `routeCategory` (`src/gtfs/route-types.ts`).
- Produces: `export const patternsCheck: ValidationCheck` with `ruleIds: ['unrealistic_speed', 'stop_far_from_shape']`; `export const SPEED_LIMITS_KMH: Readonly<Record<RouteCategory, number>>` (values from Global Constraints).

Load stop coordinates once (`Map<stopId, LonLat>`, only stops with both coordinates non-null). For each `route_patterns` row (joined to `routes.route_type`), in chunks of 200 patterns with `await ctx.checkpoint()` between chunks, read the rep trip's stop times ordered by `stop_sequence`.

Speed span algorithm:

```text
from = first stop with a known time (departure ?? arrival) and coordinates; dist = 0
for each later stop s with coordinates:
  dist += haversine(previous stop with coordinates, s)
  t = s.arrival ?? s.departure
  if t is null: continue                       // untimed stop: keep accumulating
  if t == from.time: continue                  // equal times merge into the next span
  if t > from.time and dist >= 200:
    kmh = dist / (t - from.time) * 3.6
    if kmh > limit: emit once per (route, from.stop, s.stop)
  from = s (time = s.departure ?? s.arrival); dist = 0
```

Stops without coordinates are skipped entirely (not counted, not used as `from`). Message: `Trip ${repTripId} travels ${Math.round(kmh)} km/h between ${fromName} and ${toName}.` (route, stop = from, trip; details `{toStopId, speedKmh}`).

Distance from shape: only when the pattern's `shape_id` has ≥ 2 points with coordinates (cache the polyline per shape id). For each stop with coordinates, `distanceToPolylineMeters`; keep the max per (route, stop); after all patterns, emit those > 100 m: `${stopName} is ${Math.round(m)} m from route ${label}'s line.` (route, stop; details `{distanceM}`).

- [ ] **Step 1: Write failing tests**
  - `it('finds nothing in the valid feed')`.
  - `it('flags buses faster than 150 km/h in the sample feed')` — `runCheck(patternsCheck, SAMPLE_FEED)` → exactly two `unrealistic_speed` issues: `{routeId: 'R10', stopId: 'BEATTY', details: {toStopId: 'STN_A'}}` (span merges the untimed NADAV) and `{routeId: 'R10', stopId: 'STN_A', details: {toStopId: 'NADAV'}}`; both `speedKmh > 150`.
  - `it('merges equal times instead of reporting infinite speed')` — valid feed with T20_1 rows `STN_A 10:00:00`, `FUR 10:00:00`, `BEATTY 12:00:00` (seq 1–3): the merged span STN_A→BEATTY is ~112 km in 2 h → no issue.
  - `it('skips stops without coordinates')` — SAMPLE variant with NADAV's lat/lon blank → the BEATTY→STN_A issue is still reported (direct distance ~58 km in 20 min, `speedKmh` ≈ 175), and no message contains `NaN`.
  - `it('uses the ferry limit')` — valid feed's T30_1 (ferry) shortened to `14:00 → 14:30` (~140 km/h) → one issue.
  - `it('flags a stop far from its shape')` — valid feed with SH10 point 3 moved ~1 km east to `36.914893,-116.757` (NADAV stays put; it ends up ~820 m from the line) → `stop_far_from_shape` for NADAV with `details.distanceM` `toBeGreaterThan(500)`; BEATTY and STN_A (still vertices) are not flagged.
  - `it('ignores trips without a real shape')` — R20 (no shape) never yields `stop_far_from_shape`.
- [ ] **Step 2: Run** `npx vitest run src/worker/validation/rules/patterns_test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `patternsCheck`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: validation check for speeds and stop distance from shapes"`

---

### Task 7: Stops and feed checks, check registry, whole-feed tests

**Files:**
- Create: `src/worker/validation/rules/stops.ts`, `stops_test.ts`
- Create: `src/worker/validation/rules/feed.ts`, `feed_test.ts`
- Create: `src/worker/validation/rules/index.ts`, `index_test.ts`
- Modify: `src/gtfs/route-types.ts` (add `contrastRatio`), `src/gtfs/route-types_test.ts`

**Interfaces:**
- Produces:
  - `export const stopsCheck: ValidationCheck` — `['stop_invalid_coords', 'stops_near_duplicate']`.
  - `export const feedCheck: ValidationCheck` — `['feed_expired', 'feed_not_yet_active', 'route_color_contrast']`.
  - `export const ALL_CHECKS: readonly ValidationCheck[] = [referencesCheck, stopTimesCheck, coverageCheck, patternsCheck, stopsCheck, feedCheck];`
  - `export function contrastRatio(a: string, b: string): number;` in `route-types.ts` — WCAG 2 relative luminance of `#rrggbb` colors, `(L1 + 0.05) / (L2 + 0.05)` with L1 ≥ L2.

Messages:
- `stop_invalid_coords` (location types 0/null, 1, 2): `${stopName} has missing coordinates.` / `…coordinates out of range.` (|lat| > 90 or |lon| > 180) / `…coordinates at 0,0.`
- `stops_near_duplicate`: bucket stops with coordinates by `floor(lat * 10000), floor(lon * 10000)` (~11 m cells), compare within a cell and its 8 neighbors; same `trim().toLowerCase()` name and same `COALESCE(location_type, 0)`; distance < 2 → one issue per pair (stopId = the lexically smaller id): `${nameA} and ${nameB} have the same name and are ${d.toFixed(1)} m apart.` (details `{otherStopId, distanceM}`).
- `feed_expired` (`service_end < today`): `Service in this feed ended on ${toIsoDate(end)}.`; `feed_not_yet_active` (`service_start > today`): `Service in this feed starts on ${toIsoDate(start)}.` (no links). Read `service_start`/`service_end` from `feed_summary`.
- `route_color_contrast`: only when `route_color` or `route_text_color` is non-empty; colors via `normalizeColor`, missing → `#ffffff` / `#000000`; skip if either is set but invalid; ratio < 3 → `Route ${label}'s text has a contrast ratio of ${ratio.toFixed(1)}:1 against its color.` (route; details `{ratio}`).

- [ ] **Step 1: Write failing tests**
  - `route-types_test.ts`: `contrastRatio('#ffffff', '#000000')` ≈ 21; `contrastRatio('#ff0000', '#000000')` ≈ 5.25 (`toBeCloseTo(5.25, 2)`); argument order doesn't matter.
  - `stops_test.ts`: valid feed → `[]`; stop at `0,0` → `…coordinates at 0,0.`; lat `95` → out of range; a station (type 1) with blank coords → missing; two stops named `Main St` / `main st ` 1 m apart → one `stops_near_duplicate` with `distanceM < 2`; a third `Main St` 50 m away → not flagged.
  - `feed_test.ts`: `runCheck(feedCheck, SAMPLE_FEED, new Date('2027-01-05T12:00:00Z'))` → `feed_expired` with `Service in this feed ended on 2026-12-31.`; with `new Date('2025-06-01T12:00:00Z')` → `feed_not_yet_active`; route `R20` with `route_color` `FFFF00` and `route_text_color` `FFFFFF` → contrast issue for R20; SAMPLE_FEED as is (no text colors, R30 color `green` invalid) → no contrast issues.
  - `index_test.ts`:
    - `it('finds no issues in the valid feed')` — `runValidation` with `ALL_CHECKS`, now `2026-10-10T12:00:00Z` → `{state: 'current', counts: {error: 0, warning: 0, info: 0}}`.
    - `it('finds the known defects in the sample feed')` — same on `SAMPLE_FEED` → counts `{error: 0, warning: 3, info: 0}`; rule ids `route_without_trips` ×1, `unrealistic_speed` ×2.
    - `it('every rule id is owned by exactly one check')` — flatten `ALL_CHECKS.map(c => c.ruleIds)` equals `RULE_IDS` as a set, length 18.
- [ ] **Step 2: Run** `npx vitest run src/worker/validation src/gtfs/route-types_test.ts` — Expected: FAIL in the new files.
- [ ] **Step 3: Implement** `contrastRatio`, `stopsCheck`, `feedCheck`, `ALL_CHECKS`. If the valid-feed test finds an issue, fix `VALID_FEED` (not the rule) unless the rule is wrong for valid GTFS.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: stop and feed-level validation checks"`

---

### Task 8: URL `view` param

**Files:**
- Modify: `src/state/url-state.ts`
- Modify: `src/state/url-state_test.ts` (create if absent)

**Interfaces:**
- Produces: `Selection.view: 'issues' | null`; `EMPTY_SELECTION.view = null`; `?view=issues` round-trips; any other value parses to `null`; switching feeds clears it (already true via `EMPTY_SELECTION`).

- [ ] **Step 1: Write failing tests**: `parseSelection('?feed=a&view=issues').view === 'issues'`; `parseSelection('?view=bogus').view === null`; `serializeSelection({...EMPTY_SELECTION, feed: 'a', view: 'issues'}) === '?feed=a&view=issues'`; `applyPatch({...EMPTY_SELECTION, feed: 'a', view: 'issues'}, {feed: 'b'}).view === null`.
- [ ] **Step 2: Run** `npx vitest run src/state` — Expected: FAIL.
- [ ] **Step 3: Implement**, fixing any object literals of `Selection` elsewhere that `npx tsc -b` reports.
- [ ] **Step 4: Run** `npx vitest run src/state` and `npx tsc -b` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: view=issues in the URL state"`

---

### Task 9: FeedService validation API

**Files:**
- Modify: `src/worker/feed-service.ts`
- Modify: `src/worker/feed-service_test.ts`

**Interfaces:**
- Consumes: `runValidation`, `ALL_CHECKS`, store reads (Task 2, 7).
- Produces (public `FeedService` methods, seen by the UI through `FeedApi`):

```ts
ensureValidation(feedId: string, onProgress: (progress: ValidationProgress) => void): Promise<ValidationStatus>;
getValidationSummary(feedId: string): ValidationSummary | null;
getValidationIssues(feedId: string, filter: ValidationFilter): ValidationIssue[];
getImportIssues(feedId: string, code: IssueCode): ImportIssue[];
```

State: `private validation: {feedId: string; token: CancelToken; promise: Promise<ValidationStatus>; listeners: Array<(p: ValidationProgress) => void>} | null`. `ensureValidation`: `const db = this.dbFor(feedId)`; if `this.validation?.feedId === feedId`, push the listener and return its promise; if `getCurrentCounts(db)` is non-null return `{state: 'current', counts}`; else start `runValidation(db, {now: this.deps.now(), token, checks: ALL_CHECKS, onProgress: p => listeners.forEach(l => l(p))})`, clearing `this.validation` in `finally` only if it still holds this token. `closeCurrent()` sets `this.validation.token.cancelled = true` and clears it before closing the DB. Comlink progress callbacks return promises; call them with `void`.

- [ ] **Step 1: Write failing tests** (in the existing `describe('FeedService')`, importing `VALID_FEED`):
  - `it('validates an imported feed and then reports results as current')` — import `zipFile('demo.zip')`; `ensureValidation(id, onProgress)` → `{state: 'current', counts: {error: 0, warning: 3, info: 0}}` (NOW is 2026-10-09, feed active), `onProgress` called 6 times; second call returns current without progress calls.
  - `it('joins a run already in progress')` — two calls without awaiting → same resolved object (`toBe`), and both listeners receive progress.
  - `it('cancels a run when another feed is opened')` — import two feeds A and B; `const run = service.ensureValidation(A, …)`; `service.openFeed(B)`; `await run` → `{state: 'cancelled'}`; then `ensureValidation(B, …)` → `current`; `ensureValidation(A, …)` afterwards → `current` (re-run on reopen).
  - `it('reads nothing before the first run, like a feed imported before validation existed')` — right after import (validation tables don't exist until the first run): `getValidationSummary(id)` is `null` and `getValidationIssues(id, {routeId: 'R10'})` is `[]`; then `ensureValidation` → `current` and the summary is non-null.
  - `it('returns issues for a station including its platforms')` — after validation of SAMPLE_FEED, `getValidationIssues(id, {stopId: 'STN'})` contains the `STN_A → NADAV` speed issue.
- [ ] **Step 2: Run** `npx vitest run src/worker/feed-service_test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the methods and cancellation in `closeCurrent()`.
- [ ] **Step 4: Run** `npm test` and `npx tsc -b` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: run and read validation through FeedService"`

---

### Task 10: Explorer wiring and Feed details

**Files:**
- Create: `src/ui/use-validation.ts`
- Modify: `src/app.tsx` (Explorer, FeedContent)
- Modify: `src/ui/feed-info.tsx`

**Interfaces:**
- Consumes: `FeedApi.ensureValidation` (Task 9), `formatCounts` (Task 1).
- Produces:

```ts
// use-validation.ts
export interface ValidationView {
  readonly status: AsyncState<ValidationStatus>;   // from useAsync, deps [service, feedId]
  readonly progress: ValidationProgress | null;    // only for the current feedId
}
export function useValidation(service: FeedApi, feedId: string | null): ValidationView;
```

`useValidation` wraps `useAsync(async () => feedId === null ? {state: 'cancelled'} : await service.ensureValidation(feedId, Comlink.proxy((p) => setProgress({feedId, p}))), [service, feedId])`. Progress state is tagged with `feedId` and ignored when it differs.

`Explorer` calls `useValidation(service, activeFeedId)` and passes the `ValidationView` to `FeedContent`, which passes it to `FeedInfo` with `onViewReport={() => update({view: 'issues'})}`, and passes `validation.status.status === 'ok' ? validation.status.value : null` (a `ValidationStatus | null`) to the detail views (Task 11) and the report.

`FeedInfo` replaces the "Import notes" row with `<dt>Issues</dt><dd>…</dd>`:
- loading or `cancelled`: `Checking feed…` plus ` (${checkIndex + 1} of ${checkCount})` when progress is known.
- `current` with non-empty `formatCounts`: that text, then a `View report` link-button.
- `current` with all zero: `No issues found`, then `View report`.
- `failed`: `Couldn't check this feed: ${message}`.
- `error` (Comlink/worker error): `Couldn't check this feed.`

- [ ] **Step 1: Implement** `use-validation.ts`, the `FeedInfo` row (new props `validation: ValidationView`, `onViewReport: () => void`), and the wiring. (Covered by the E2E in Task 12; no unit test for React glue, matching the repo.)
- [ ] **Step 2: Run** `npx tsc -b && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 3: Manual check** with `VITE_MAP_PROVIDER=fake npm run dev`: upload the sample feed, open Feed details → shows `Checking feed…` then `3 warnings · View report` (while the current date is in 2026).
- [ ] **Step 4: Commit** — `git commit -m "feat: run validation on feed open and show issue counts"`

---

### Task 11: Report view and inline issue sections

**Files:**
- Create: `src/ui/issues-report.tsx`
- Create: `src/ui/entity-issues.tsx`
- Modify: `src/app.tsx` (render the report when `selection.view === 'issues'` and no route/stop)
- Modify: `src/ui/route-detail.tsx`, `src/ui/stop-detail.tsx` (add `validation: ValidationStatus | null` prop; render `EntityIssues`)
- Modify: `src/index.css` (only if needed for list spacing)

**Interfaces:**
- Consumes: `FeedApi.getValidationSummary`, `getValidationIssues`, `getImportIssues`; `RULES`.
- Produces:

```tsx
export function IssuesReport(props: {
  service: FeedApi; feedId: string; validation: ValidationStatus | null;
  onBack: () => void; onOpenRoute: (routeId: string) => void; onOpenStop: (stopId: string) => void;
}): ReactElement;
export function EntityIssues(props: {
  service: FeedApi; feedId: string; validation: ValidationStatus | null;
  filter: {readonly routeId: string} | {readonly stopId: string};
}): ReactElement | null;
```

Copy and structure (accessible names are the E2E contract):
- Report: back button `← Back to feed`; `<h2>Feed issues</h2>`. While `validation` isn't `current`: `<p className="muted">Checking feed…</p>`. Then `<section aria-label="Errors">` / `Warnings` / `Info` / `Import notes`, each with an `<h3>` of the same text, omitted when empty. One `<details>` per rule: `<summary>{RULES[id].title} ({total.toLocaleString()})</summary>`, then `<p className="muted">{description}</p>`; on first open, fetch `getValidationIssues(feedId, {ruleId})` (keyed by `[service, feedId, ruleId, validation]` via `useAsync` in a child component rendered only when open). If `stored < total`: `Showing {stored} of {total.toLocaleString()}`. If `errorMessage`: `This check couldn't run: {errorMessage}`. Each issue: `<li>{message} {button}</li>`; button `Open route {routeName}` when `routeName !== null` (calls `onOpenRoute`), else `Open stop {stopName}` when `stopName !== null`, else none.
- Import notes: one `<details>` per code, summary `{code} ({count})`, expanding to `getImportIssues` messages.
- `onOpenRoute(id)` = `update({route: id, stop: null, view: null})`; `onOpenStop(id)` = `update({stop: id, view: null})`; `onBack` = `update({view: null})`.
- `EntityIssues`: returns `null` unless `validation?.state === 'current'` and issues load non-empty; otherwise `<section aria-label="Issues"><h3>Issues ({n})</h3><ul>{messages}</ul></section>`. Route detail renders it after the heading; stop detail after the routes chips.

- [ ] **Step 1: Implement** both components and wiring.
- [ ] **Step 2: Run** `npx tsc -b && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: issues report view and inline issues in route and stop detail"`

---

### Task 12: End-to-end tests

**Files:**
- Modify: `e2e/helpers.ts` (add `uploadValidSample(page)`: file name `demo-valid.zip`, URL `/feed=file-demo-valid/`)
- Create: `e2e/validation.spec.ts`

- [ ] **Step 1: Write the tests**

```ts
test('reports sample feed issues and links to the affected route', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  const sidebar = page.locator('aside');
  await sidebar.getByText('Feed details').click();
  await expect(sidebar.getByText(/\d+ warnings?/)).toBeVisible({timeout: 30_000});
  await sidebar.getByRole('button', {name: 'View report'}).click();
  await expect(page).toHaveURL(/view=issues/);
  await expect(sidebar.getByRole('heading', {name: 'Feed issues'})).toBeVisible();
  const warnings = sidebar.getByRole('region', {name: 'Warnings'});
  await warnings.getByText('Unrealistic speed (2)').click();
  await warnings.getByRole('button', {name: 'Open route 10'}).first().click();
  await expect(page).toHaveURL(/route=R10/);
  await expect(page).not.toHaveURL(/view=issues/);
  await expect(sidebar.getByRole('region', {name: 'Issues'}).getByRole('heading', {name: 'Issues (2)'})).toBeVisible();
  await page.goBack();
  await expect(sidebar.getByRole('heading', {name: 'Feed issues'})).toBeVisible();
});

test('says a valid feed has no issues', async ({page}) => {
  await page.goto('/');
  await uploadValidSample(page);
  await page.locator('aside').getByText('Feed details').click();
  await expect(page.locator('aside').getByText('No issues found')).toBeVisible({timeout: 30_000});
});
```

(The first test avoids exact feed-level counts because `feed_expired` depends on the real date; the R10 speed issues don't.)

- [ ] **Step 2: Run** `npm run e2e` — Expected: all PASS (existing specs too).
- [ ] **Step 3: Commit** — `git commit -m "test: e2e for the issues report"`

---

### Task 13: Performance measurement and docs

**Files:**
- Modify: `scripts/perf-import.ts`
- Modify: `docs/perf-baseline.md`
- Modify: `CLAUDE.md` (Architecture: a **Validation** paragraph)

**Interfaces:**
- Consumes: `runValidation`, `ALL_CHECKS`.

- [ ] **Step 1: Extend the perf script**: after the existing import timing, run `runValidation(db, {now: new Date(), token: {cancelled: false}, checks})` where `checks` wraps each of `ALL_CHECKS` to record its total time and the longest stretch between its `checkpoint()` calls (wrap `ctx.checkpoint` to time the gaps). Print a `console.table` of `{check: ruleIds[0]…, totalMs, maxStepMs}` plus the total.
- [ ] **Step 2: Run** `npm run perf -- <MBTA zip>` (from `https://files.mobilitydatabase.org/mdb-437/latest.zip`; ask your human partner if it can't be downloaded). Expected: total < ~10 s, every `maxStepMs` < ~250. If a check exceeds the step budget, add checkpoints at a finer chunk size in that check (e.g. `TRIP_BATCH` 500, patterns per chunk 50), re-run, and commit that change separately.
- [ ] **Step 3: Record** the numbers in a new "Validation" section of `docs/perf-baseline.md` (machine, Node version, date, per-check table).
- [ ] **Step 4: Update `CLAUDE.md`** Architecture with a short **Validation** paragraph: checks in `src/worker/validation/rules/` own rule ids from `src/shared/validation.ts`; results are buffered and written in one transaction with `RULESET_VERSION` (bump it on any rule/threshold/message change); `ensureValidation` runs or joins a run and `closeCurrent()` cancels; checks must call `ctx.checkpoint()` at least every ~250 ms of work; `VALID_FEED` must validate clean.
- [ ] **Step 5: Run** `npm test && npx tsc -b && npm run lint` — Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "docs: validation performance baseline and architecture notes"`
