# GTFS Visualizer — Feed Translations & Language Selector

**Date:** 2026-10-09
**Status:** Approved design, pending implementation plan
**Scope:** Import GTFS `translations.txt`, show feed text in a chosen language, and drive the Mapbox base-map label language from the same choice.

## 1. Purpose

Many feeds publish names in more than one language (e.g. bilingual stop names). A single language selector lets a viewer read the feed's text — and the base map's labels — in any language the feed provides, and share a link that opens in that language.

## 2. Decisions

| Topic | Decision | Rationale |
|---|---|---|
| What is translated | Feed text from `translations.txt` **and** Mapbox base-map labels, from one selector | One control, consistent result |
| Where the choice lives | URL query parameter `?lang=` | URL is already the source of truth for selection; links are shareable |
| Translated fields | `stops.stop_name`, `routes.route_short_name`, `routes.route_long_name`, `trips.trip_headsign` (departures and pattern headsigns), `agency.agency_name`, `feed_info.feed_publisher_name` | Exactly the text the UI shows today |
| Where translation happens | At query time in the worker (Approach 1) | Keeps "worker owns all data"; avoids materializing translations at import |
| Legacy (pre-spec) `translations.txt` | Skipped with a warning | Non-standard; rare |

Rejected: resolving translations at import into a flat table (value-based translations would have to be expanded per matching record, and any change to matching logic would require re-import); translating in the UI (spreads lookup logic across views, breaks the worker boundary).

## 3. Data & import

### Table

`translations` is added to `GTFS_TABLES` in `src/gtfs/schema.ts`:

| Column | Type | Required |
|---|---|---|
| `table_name` | text | yes |
| `field_name` | text | yes |
| `language` | text | yes |
| `translation` | text | yes |
| `record_id` | text | no |
| `record_sub_id` | text | no |
| `field_value` | text | no |

The file is optional (`requiredFile: false`). Indexes, created after load like other tables:

- `(table_name, field_name, language, record_id, record_sub_id)`
- `(table_name, field_name, language, field_value)`

### Record keys

| `table_name` | `record_id` refers to | `record_sub_id` |
|---|---|---|
| `agency` | `agency_id` | — |
| `stops` | `stop_id` | — |
| `routes` | `route_id` | — |
| `trips` | `trip_id` | — |
| `feed_info` | not used — a translation applies to the single row | — |

### Validation (via `IssueCollector`, existing per-file caps)

- Row has neither `record_id` nor `field_value` (table other than `feed_info`) → `invalid_value` error, row skipped.
- Row has both `record_id` and `field_value` → `invalid_value` error, row skipped.
- Unknown `table_name` / `field_name` → stored, no issue (valid GTFS; lets more fields be translated later without re-import).
- **Legacy format:** header contains `trans_id` and `lang` but not `table_name` → whole file skipped, one `warning` with new `IssueCode` `legacy_translations` ("translations.txt uses an older non-standard format and was ignored"). Never fatal.

### Language list

`derive.ts` writes a `languages` key to `feed_summary` (JSON array): `feed_info.feed_lang` (if present and not `mul`) followed by the distinct `translations.language` values, de-duplicated case-insensitively, keeping the first spelling.

## 4. Worker queries & API

### Translation helper

`src/worker/translate.ts` builds the SQL expression for one translatable field given the table, the field, the row alias, and whether a language is bound. The expression is:

1. the translation matched by `record_id` (table/field/language only for `feed_info`), else
2. the translation matched by `field_value = <original value>`, else
3. the original column.

`lang` is passed as a bound parameter. When `lang` is `null` the helper returns the bare column, so untranslated queries are identical to today's. All name-returning queries in `queries.ts` use the helper, including the shared `ROUTE_COLUMNS`, so `routeLabel` and everything built on it follows. Pattern headsigns are translated by joining `trips` on `route_patterns.rep_trip_id` (the trip they were copied from). Duplicate translations for the same key resolve to the first row in the file.

### API (`FeedService`, seen by the UI as `FeedApi`)

- `getRoutes`, `getRouteDetail`, `getStopDetail`, `getStopDepartures`, `getFeedSummary` take a trailing `lang: string | null`.
- New `getFeedLanguages(feedId: string): FeedLanguages` where `FeedLanguages = {languages: readonly string[]; originalLanguage: string | null}` (`originalLanguage` is `null` when `feed_lang` is missing or `mul`). It reads only `feed_summary`, so it is not itself translated (the summary is) and works on feeds imported before this feature (no `languages` key → empty list → no selector, and no translation SQL ever runs against a DB without a `translations` table).
- New `getMapLabels(feedId: string, lang: string | null): MapLabels` where `MapLabels = {routes: Record<string, string>; stops: Record<string, string>}`, keyed by route id (value = route label) and stop id.
- `getRouteShapesGeoJSON` / `getStopsGeoJSON` are unchanged and keep original names (the fake map's buttons and existing E2E tests rely on them; re-sending shape geometry on a language change would be wasteful).

### Cost

Two indexed lookups per translated field per row, only when a language is selected. `npm run perf` gains a timing for `getMapLabels` and `getStopDepartures` at the busiest stop with a translation language selected; results go in `docs/perf-baseline.md`.

## 5. UI, state & map

### URL state (`src/state/url-state.ts`)

- `Selection` gains `lang: string | null`, parsed from / serialized to `?lang=`.
- `applyPatch` preserves `lang` when switching feeds (other fields still reset).
- Changing the language uses `replace: true` so it does not add history entries.

### Effective language

Pure function `resolveLanguage(requested, browserLanguages, feedLanguages)` in `src/state/resolve-language.ts`. Language codes compare case-insensitively.

1. `requested` (`?lang=`) if it is the reserved value `original` (always the original text), or if it is in `feedLanguages.languages`.
2. Else the first of `browserLanguages` (`navigator.languages`) that matches: exact match first, then primary-subtag match in either direction (`fr-CA` ↔ `fr`).
3. Else `null` (original text).

The result uses the feed's spelling of the code. If it equals `feedLanguages.originalLanguage` the language passed to the worker is `null`. An unavailable `?lang=` is left in the URL untouched, so it applies again after switching to a feed that has it.

### Selector

- `<select aria-label="Language">` in the sidebar header.
- Shown only when a feed is open and it has at least one translation language besides the original.
- Option labels: the language's own name via `new Intl.DisplayNames([code], {type: 'language'})`, wrapped in try/catch with the raw code as fallback. The original-text option has the value `original` (written to the URL as `lang=original`, so it sticks even when the browser's language has a translation) and reads "<name> (original)", or "Feed default" for a `mul` / missing `feed_lang`.

### Data flow

`Explorer` resolves the effective language and passes it to the sidebar views and `MapView`. Each view adds it to its `useAsync` deps, so a previous language's result is never shown.

### Map

- `MapAdapter` gains `setLanguage(lang: string | null): void`.
- Mapbox adapter: `map.setLanguage(...)` with the effective display language — the selected translation, or the feed's original language. `null` (e.g. `mul` feeds) leaves Mapbox's default local names. Unsupported languages fall back to Mapbox's defaults.
- Fake adapter: records `language` in its `data-state` JSON.
- `MapView` loads `getMapLabels(feedId, lang)` when a language is selected; the hover tooltip uses the label, falling back to the feature's original `name`.
- A language change never re-fits the map bounds.

## 6. Error handling

No new user-facing errors. Import problems are import issues (§3). An unknown `lang` simply matches no rows and yields original text. `Intl.DisplayNames` failures fall back to the code. Mapbox ignores unsupported languages.

## 7. Testing

- `src/test-fixtures/sample-feed.ts` (still `fflate`-only): add a French `translations.txt` with a `record_id` stop name, a `field_value` headsign, a `feed_info` translation, a stop with both a `record_id` and a `field_value` translation, and invalid rows; plus a legacy-format variant.
- `loader_test.ts`: rows imported; invalid row reported and skipped; legacy file reported as `legacy_translations` and skipped.
- `derive_test.ts` / `queries_test.ts`: `getFeedLanguages` contents, including `mul`, missing `feed_lang`, and a DB without a `languages` key.
- `queries_test.ts`: each translated field; `record_id` precedence over `field_value`; `null` lang returns originals; parent-station departures translated; `getMapLabels`.
- `url-state_test.ts`: `lang` parse/serialize; preserved on feed switch.
- `resolve-language_test.ts`: precedence; primary-subtag matching both ways; case-insensitivity.
- `e2e/explorer.spec.ts`: choosing French translates sidebar names, sets `?lang=fr`, sets the fake map's `language`; reload keeps it; a feed without translations shows no selector.
- `npm run perf`: translated timings (§4).
