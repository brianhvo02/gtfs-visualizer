# GTFS Visualizer — Validation

**Date:** 2026-10-10
**Status:** Approved design, pending implementation plan
**Scope:** Sub-project 3 of the roadmap in `2026-10-09-feed-import-and-explorer-design.md`: rule-based checks across a feed's tables, stored per feed, shown as a report and inline in the explorer, building on the existing `import_issues` table.

## 1. Purpose

Validation serves two readers, in this order:

1. **People exploring a feed** who want to know why something looks wrong: a route with no departures, a line drawn across the ocean, a stop with no service.
2. **Feed producers and developers** checking quality.

The first rule set is curated for visible impact on the explorer rather than full spec coverage (the canonical MobilityData validator remains the reference for that). The distinguishing feature is that every issue links to the entity it affects, and every route and stop shows its own issues, so the report and the explorer point at each other. The rule engine is built so the rule set can grow toward broader coverage later.

### Decisions

| Question | Decision |
|---|---|
| Audience | Explorers first; producers served by the same report |
| When it runs | After import and lazily on open; results stored per feed with a rule-set version, re-run when missing or outdated |
| Where issues show | A report view, plus an inline section in route and stop detail |
| Engine | Rule modules run one at a time in the worker, yielding between rules and chunks |

## 2. Constraints that shaped the design

- **The worker is single-threaded and owns the only database handle.** `FeedService` holds one "current" feed DB; sahpool gives one worker exclusive access to its files, so a second validation worker would need a full copy of the DB (~350 MB for MBTA). Validation therefore runs on the same worker, and explorer queries queued on Comlink run only when validation yields.
- **Feeds imported before this feature have no validation tables**, so results must be computed lazily and the absence of tables is a normal state.
- **MBTA has 3.1M `stop_times` rows** (import ~22 s in Node). Per-trip scans must be chunked; geometry checks run per unique pattern from `route_patterns`, not per trip.

## 3. Storage

New tables in each feed DB, created by the first validation run:

```sql
CREATE TABLE validation_issues (
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,        -- 'error' | 'warning' | 'info'
  route_id TEXT,
  stop_id TEXT,
  trip_id TEXT,
  message TEXT NOT NULL,
  details_json TEXT              -- structured facts, e.g. {"speedKmh":412,"toStopId":"B"}
);
CREATE INDEX idx_validation_issues_rule_id ON validation_issues (rule_id);
CREATE INDEX idx_validation_issues_route_id ON validation_issues (route_id);
CREATE INDEX idx_validation_issues_stop_id ON validation_issues (stop_id);

CREATE TABLE validation_rules (
  rule_id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  total INTEGER NOT NULL,        -- true count, including rows beyond the cap
  error_message TEXT             -- set when the rule threw
);

CREATE TABLE validation_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: ruleset_version, completed_at
```

- **Cap:** at most 200 stored rows per rule; `validation_rules.total` keeps the real count.
- **Atomic results:** a run writes `validation_issues_next` and `validation_rules_next`. On completion, one transaction drops the old tables, renames the `_next` tables into place, recreates the indexes, and writes `validation_meta`. Readers never see partial results. A run that stops early (tab closed, worker crash, feed switched) leaves only `_next` tables, which the next run drops before starting.
- **Severities:** `error` = data is broken or dropped; `warning` = suspicious but usable; `info` = low stakes. `fatal` stays specific to import.
- **Versioning:** `RULESET_VERSION` (integer, `src/shared/validation.ts`). Results are current when `validation_meta.ruleset_version` equals it. Any change to rules, thresholds, or messages bumps it, which re-validates each feed the next time it is opened.

`import_issues` is unchanged; the report reads it alongside the validation tables.

## 4. Worker

### 4.1 Files

| File | Responsibility |
|---|---|
| `src/shared/validation.ts` | `RuleId` union, `RULESET_VERSION`, `RULES` metadata (id, severity, title, one-line explanation), `ValidationIssue`, `ValidationStatus`, `ValidationProgress`, `ValidationSummary`, `ValidationFilter` types |
| `src/worker/validation/runner.ts` | Creates `_next` tables, runs rules in order, capped `emit`, `checkpoint`, cancellation, per-rule error capture, final swap |
| `src/worker/validation/geo.ts` | Haversine distance; point-to-polyline distance using a local equirectangular projection |
| `src/worker/validation/rules/references.ts` | Broken-reference rules |
| `src/worker/validation/rules/schedule.ts` | Schedule rules |
| `src/worker/validation/rules/geography.ts` | Coordinate and shape rules |
| `src/worker/validation/rules/feed.ts` | Feed-level rules |

### 4.2 Rule interface

```ts
interface RuleContext {
  readonly db: Database;
  /** Records an issue; rows beyond the cap are counted but not stored. */
  emit(issue: EmittedIssue): void;
  /** Yields a macrotask so queued queries run; throws ValidationCancelled if cancelled. */
  checkpoint(): Promise<void>;
  /** Today as YYYYMMDD in the feed's agency_timezone (browser time zone if invalid). */
  readonly today: string;
}

interface ValidationRule {
  readonly id: RuleId;
  run(ctx: RuleContext): Promise<void>;
}
```

Severity comes from `RULES[id]`, not from the emit call. The runner calls `checkpoint()` between rules; heavy rules call it between chunks. Target: no stretch between checkpoints longer than ~250 ms on MBTA.

### 4.3 Rules

| Rule | Method | Severity | Links to |
|---|---|---|---|
| `trip_unknown_route` | SQL anti-join `trips.route_id` → `routes` | error | trip |
| `trip_unknown_service` | SQL anti-join `trips.service_id` → union of `calendar` and `calendar_dates` service ids | error | route, trip |
| `trip_unknown_shape` | Trip has `shape_id` with no `shapes` points (line is synthesized from stops) | warning | route, trip |
| `stop_time_unknown_trip` | SQL anti-join `stop_times.trip_id` → `trips`; one issue per distinct trip id | error | trip id in details |
| `stop_time_unknown_stop` | SQL anti-join `stop_times.stop_id` → `stops`; one issue per (trip, stop id) | error | route, trip |
| `stop_unknown_parent` | `parent_station` must exist and have the expected type: types 0, 2, 3 need a station (1); type 4 needs a platform (0) | error | stop |
| `stop_times_out_of_order` | Batches of 2,000 trips via the `stop_times(trip_id, stop_sequence)` index; `LAG` over `arrival_secs`/`departure_secs`; flags a time earlier than the previous stop's, or departure before arrival; one issue per trip (first offending stop in details); checkpoint per batch | error | route, trip |
| `trip_too_few_stops` | Same batches; trip with fewer than 2 stop times | error | route, trip |
| `unrealistic_speed` | Per `route_patterns` row, using its `rep_trip_id`. Consecutive stops with equal times are merged into the next span with a time change, so minute rounding never yields infinite speed. Spans under 200 m are skipped. Threshold by route category: bus, tram, subway, trolleybus 150 km/h; rail 500; ferry 80; cable tram, aerial lift, funicular 50; other 150. One issue per (route, from stop, to stop) | warning | route, from stop; to stop and km/h in details |
| `route_without_trips` | Route with no `route_patterns` rows | warning | route |
| `stop_unused` | Location type 0 (or empty) or 1 not present in `stop_routes` | warning | stop |
| `service_never_active` | Expand each service id with `gtfs/service.ts` over its calendar range plus exceptions; zero active dates | warning | one issue per route using the service |
| `stop_invalid_coords` | Location types 0–2: coordinates missing, out of range, or exactly 0,0 | error | stop |
| `stop_far_from_shape` | Per pattern whose trip has a real shape (not synthesized): distance from each stop to the shape polyline > 100 m; one issue per (route, stop) with the largest distance | warning | route, stop; meters in details |
| `stops_near_duplicate` | Grid buckets in JS; same normalized name (trimmed, case-folded) and location type, < 2 m apart; one issue per pair | info | stop; other stop in details |
| `feed_expired` | `feed_summary` service end < `today` | warning | feed |
| `feed_not_yet_active` | `feed_summary` service start > `today` | warning | feed |
| `route_color_contrast` | Only when `route_color` or `route_text_color` is set (missing ones default to `FFFFFF` / `000000`); WCAG contrast ratio < 3:1 | info | route |

Messages are composed in the worker in English and use ids plus original (untranslated) names, e.g. *"Trip 1234 travels 412 km/h between Park Street and Downtown Crossing."* Raw numbers go in `details_json`.

**Known limitations** (by design):
- `unrealistic_speed` checks one representative trip per pattern. Trips in a pattern rarely differ in running times, and checking every trip would scan all of `stop_times`.
- Rows the importer already skipped (e.g. an invalid `stop_lat`) are reported as import issues and are not seen by rules.

### 4.4 FeedService API

```ts
ensureValidation(feedId: string, onProgress: (p: ValidationProgress) => void): Promise<ValidationStatus>;
getValidationSummary(feedId: string): ValidationSummary | null;
getValidationIssues(feedId: string, filter: ValidationFilter): ValidationIssue[];
```

- `ValidationProgress = {ruleIndex, ruleCount, ruleId}`.
- `ValidationStatus = {state: 'current', counts: {error, warning, info}} | {state: 'cancelled'} | {state: 'failed', message}`.
- `ensureValidation` opens the feed (as `openFeed` does). If results are current it returns immediately; otherwise it runs the validator. A call while a run for the same feed is in progress joins that run's promise (its `onProgress` is added to the listeners).
- `closeCurrent()` (switching or deleting the feed) cancels an in-progress run; the run resolves `cancelled` at its next checkpoint.
- A rule that throws is recorded in `validation_rules.error_message` and the run continues. A failure of the run itself (e.g. quota error during the swap) resolves `failed` and leaves previous results intact.
- `getValidationSummary` returns `null` when results are missing or outdated. Otherwise: per rule `{ruleId, severity, total, stored, errorMessage}`, plus import issues grouped by code `{code, severity, count}` excluding `suppressed`.
- `ValidationFilter = {ruleId} | {routeId} | {stopId}`. A `stopId` that is a station also matches its child stops. Results are ordered by severity, then rule, then insertion.

## 5. UI

### 5.1 URL

Add `view` to `Selection`: `'issues'` or `null` (`?feed=x&view=issues`). Selecting an issue's target patches `{route}` or `{stop}` and sets `view: null`, using `pushState`, so Back returns to the report. Switching feeds clears `view`, as it already clears `route` and `stop`.

### 5.2 Explorer state

`Explorer` calls `ensureValidation` when a feed opens; an import opens the feed it created, so this covers "after import" and "lazily on open" with one path. It holds `validation: {status | progress, revision}`; `revision` increments when a run finishes. Issue views include `revision` in their `useAsync` deps so they refresh when results arrive.

### 5.3 Views

- **Feed details:** "Import notes: N recorded" becomes **Issues**, one of:
  - "Checking feed… (7 of 18)"
  - "3 errors · 12 warnings · 4 info · View report"
  - "No issues found · View report" (the report still lists import notes, if any)
  - "Couldn't check this feed: …"
- **Report view** (`src/ui/issues-report.tsx`, shown when `view=issues`): heading "Feed issues" and a back link. Sections Errors, Warnings, Info, Import notes; within each, one `<details>` per rule with issues, showing title, count, and the rule's one-line explanation. Expanding fetches `{ruleId}` issues. Each issue shows its message and, when it has a target, a button "Open route <short or long name>" or "Open stop <name>"; route takes precedence when both are set. Capped rules show "Showing 200 of 1,532". Rules that failed show "This check couldn't run: …".
- **Inline sections** (`src/ui/entity-issues.tsx`): route and stop detail show "Issues (N)" with the messages, only when N > 0.

Accessible names (headings, button labels, section labels) are part of the E2E contract.

## 6. Error handling

| Condition | Behavior |
|---|---|
| Rule throws | Recorded for that rule; other rules run; report shows the error |
| Run fails (e.g. quota) | Status `failed`; previous results kept; Feed details shows the message; explorer unaffected |
| Feed switched or deleted mid-run | Run cancelled; `_next` tables cleaned up by the next run |
| Worker crash mid-run | Restarted worker sees outdated or missing results and re-runs on open |
| Results missing or outdated | Treated as "not yet checked"; inline sections hidden until a run completes |

## 7. Testing

- **Unit (Vitest):**
  - `geo_test.ts`: haversine and point-to-polyline against known values, including segment endpoints and one-point lines.
  - One test file per rule group. Each starts from the sample feed (via `withFile` variants and `loadSampleDb`) with one seeded defect, and asserts the issue, its severity, entity links, and details. Rules that depend on the date receive `today` from the test.
  - A combined test: **the clean sample feed validates with zero issues.** If the current fixture trips a rule (e.g. an unused stop), the fixture is fixed, not the rule.
  - `runner_test.ts`: cap and true totals; throwing rule recorded while others run; cancellation leaves previous results and a `_next` table that the next run removes; atomic swap; same version skips, different version re-runs.
  - `feed-service_test.ts`: concurrent `ensureValidation` calls join one run; `closeCurrent` cancels; a feed without validation tables validates on first call; summary and filters (including station → children).
- **E2E (Playwright, fake map):** a sample-feed variant with seeded defects (built in `sample-feed.ts`, which stays fflate-only):
  - Feed details shows counts.
  - Report → expand a rule → "Open route …" → route detail shows its Issues section → Back returns to the report.
  - The clean sample feed shows "No issues found".
- **Performance:** `npm run perf` also times `ensureValidation` with a per-rule breakdown; MBTA numbers go in `docs/perf-baseline.md`. Targets on MBTA in Node: full run under ~10 s; no stretch between checkpoints over ~250 ms. A rule that misses the budget gets finer chunking.

## 8. Out of scope

Full canonical-validator coverage; `frequencies.txt` and block rules; map geometry for individual issues (e.g. drawing the offending segment); warning markers in the route list; report export; translated issue messages; validating feeds other than the open one.
