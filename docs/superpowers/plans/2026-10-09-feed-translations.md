# Feed Translations & Language Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import GTFS `translations.txt`, let the viewer pick a language from the ones the feed provides, and show feed text and Mapbox base-map labels in that language.

**Architecture:** `translations.txt` becomes a regular table-driven GTFS table. The worker translates at query time: a helper in `src/worker/translate.ts` wraps each translatable column in a `COALESCE` of a record-id match, a field-value match and the original, bound to a `$lang` parameter. The UI keeps the requested language in `?lang=`, resolves it against the feed's languages and the browser's, passes the result to every query and to the map adapter.

**Tech Stack:** TypeScript, React 19, `@sqlite.org/sqlite-wasm` (worker, Comlink), Vitest, Playwright, Mapbox GL JS 3.32.

**Spec:** `docs/superpowers/specs/2026-10-09-feed-translations-design.md`

## Global Constraints

- Translated fields, exactly: `stops.stop_name`, `routes.route_short_name`, `routes.route_long_name`, `trips.trip_headsign`, `agency.agency_name`, `feed_info.feed_publisher_name`.
- URL parameter name: `lang`. Reserved value `original` means "original text".
- Selector: `<select aria-label="Language">`; original option label `<name> (original)`, or `Feed default` when the feed has no original language.
- New issue code: `legacy_translations`, severity `warning`, message `translations.txt uses an older non-standard format and was ignored.`
- Google TypeScript style per `CLAUDE.md`: named exports only, no `any`, no non-null `!`, explicit return types on exports, kebab-case file names, relative imports with `.ts`/`.tsx` extensions.
- UI code imports from `src/worker` with `import type` only; shared types go in `src/shared/types.ts`.
- `src/test-fixtures/sample-feed.ts` depends only on `fflate`.
- Unit tests are `*_test.ts` next to the code; E2E specs in `e2e/`.
- Commit messages end with the repo's attribution line (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Review Focus

1. **Feeds imported before this feature** (DB has no `translations` table and no `languages` key): no selector, no SQL errors. Pinned in Task 2 (`getFeedLanguages` on a stripped DB) and Task 3 (null-language queries on a DB without the table).
2. **Language code case differs** between the URL/browser and the feed (`?lang=de`, feed has `DE`): resolves to the feed's spelling so the worker's exact match hits. Pinned in Task 4.
3. **Empty `translation` value** in a row: shows the original text, never a blank. Pinned in Task 3 (`FUR`).
4. **Duplicate translations for the same key**: first row in the file wins, deterministically. Pinned in Task 3 (`STN_A`).
5. **Switching to a feed that lacks the chosen language**: original text shown, `?lang=` left in the URL so it applies again later. Pinned in Task 4 (`resolveLanguage` + `applyPatch`).

---

### Task 1: Import `translations.txt`

**Files:**
- Create: `src/gtfs/translations.ts`, `src/gtfs/translations_test.ts`
- Modify: `src/shared/types.ts` (`IssueCode`), `src/gtfs/schema.ts` (`TableDef`, `GTFS_TABLES`), `src/worker/table-writer.ts` (`createTableWriter`), `src/worker/loader.ts` (`createFileConsumer`), `src/test-fixtures/sample-feed.ts`
- Test: `src/worker/loader_test.ts`

**Interfaces:**
- Produces: `IssueCode` gains `'legacy_translations'`.
- Produces: `TableDef.checkRow?: (get: (column: string) => string) => string | null` — returns an error message to skip the row.
- Produces: `isLegacyTranslationsHeader(header: readonly string[]): boolean`, `checkTranslationRow(get: (column: string) => string): string | null` in `src/gtfs/translations.ts`.
- Produces in `sample-feed.ts`: `SAMPLE_TRANSLATIONS: string`, `TRANSLATED_FEED: Readonly<Record<string, string>>` (= `withFile('translations.txt', SAMPLE_TRANSLATIONS)`), `LEGACY_TRANSLATIONS: string`.

- [ ] **Step 1: Add the fixtures to `src/test-fixtures/sample-feed.ts`**

Use the file's `lines(...)` helper. Line numbers in comments are the CSV line numbers tests refer to.

```ts
export const SAMPLE_TRANSLATIONS = lines(
  'table_name,field_name,language,translation,record_id,record_sub_id,field_value',
  'stops,stop_name,fr,Gare Centrale,STN,,', // 2
  'stops,stop_name,fr,Aéroport de Beatty,BEATTY,,', // 3
  'stops,stop_name,fr,Avenue Nord / Avenue D,,,North Ave / D Ave N', // 4: by value
  'stops,stop_name,fr,Quai A,STN_A,,', // 5: id beats value (line 6)
  'stops,stop_name,fr,Quai (par valeur),,,Central Station Platform A', // 6
  'stops,stop_name,fr,Quai A bis,STN_A,,', // 7: duplicate of 5, loses
  'routes,route_long_name,fr,Aéroport - Centre,R10,,', // 8
  'trips,trip_headsign,fr,Centre,,,Central', // 9
  'agency,agency_name,fr,Régie de transport démo,DTA,,', // 10
  'feed_info,feed_publisher_name,fr,Éditeur démo,,,', // 11
  'stops,stop_name,fr,Sans clé,,,', // 12: invalid, neither key
  'stops,stop_name,fr,Deux clés,FUR,,Furnace Creek', // 13: invalid, both keys
  'stops,stop_name,fr,,FUR,,', // 14: empty translation
  'stops,stop_name,DE,Zentralbahnhof,STN,,', // 15
);
export const LEGACY_TRANSLATIONS = lines('trans_id,lang,translation', 'Central Station,fr,Gare Centrale');
```

- [ ] **Step 2: Write failing tests**

`src/gtfs/translations_test.ts`:

```ts
const row = (values: Record<string, string>) => (column: string): string => values[column] ?? '';

it('accepts a record_id or a field_value, and feed_info with neither', () => {
  expect(checkTranslationRow(row({table_name: 'stops', record_id: 'STN'}))).toBeNull();
  expect(checkTranslationRow(row({table_name: 'stops', field_value: 'Central'}))).toBeNull();
  expect(checkTranslationRow(row({table_name: 'feed_info'}))).toBeNull();
});
it('rejects neither or both keys', () => {
  expect(checkTranslationRow(row({table_name: 'stops'}))).toBe('A translation needs either record_id or field_value.');
  expect(checkTranslationRow(row({table_name: 'stops', record_id: 'FUR', field_value: 'Furnace Creek'}))).toBe(
    'A translation must not have both record_id and field_value.',
  );
});
it('detects the legacy header', () => {
  expect(isLegacyTranslationsHeader(['trans_id', 'lang', 'translation'])).toBe(true);
  expect(isLegacyTranslationsHeader(['table_name', 'field_name', 'language', 'translation', 'trans_id', 'lang'])).toBe(false);
});
```

In `src/worker/loader_test.ts`, using `loadSampleDb(TRANSLATED_FEED)` and `loadSampleDb(withFile('translations.txt', LEGACY_TRANSLATIONS))`:

```ts
it('imports translations and skips invalid rows', async () => {
  const {db} = await loadSampleDb(TRANSLATED_FEED);
  expect(db.selectValue('SELECT count(*) FROM translations')).toBe(12); // 14 data rows − lines 12, 13
  const invalid = db.selectObjects("SELECT line, code, severity FROM import_issues WHERE file = 'translations.txt' ORDER BY line");
  expect(invalid).toEqual([
    {line: 12, code: 'invalid_value', severity: 'error'},
    {line: 13, code: 'invalid_value', severity: 'error'},
    {line: 14, code: 'missing_value', severity: 'error'},
  ]);
});
it('ignores a legacy translations file with one warning', async () => {
  const {db} = await loadSampleDb(withFile('translations.txt', LEGACY_TRANSLATIONS));
  expect(db.selectValue('SELECT count(*) FROM translations')).toBe(0);
  expect(db.selectObjects("SELECT code, severity, message FROM import_issues WHERE file = 'translations.txt'")).toEqual([
    {code: 'legacy_translations', severity: 'warning', message: 'translations.txt uses an older non-standard format and was ignored.'},
  ]);
});
```

Adjust the `import_issues` column names to the table's real ones (`column_name`, etc.) if they differ; the assertions above use only `line`, `code`, `severity`, `message`, `file`.

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run src/gtfs/translations_test.ts src/worker/loader_test.ts`
Expected: FAIL — `./translations.ts` not found; `no such table: translations`.

- [ ] **Step 4: Implement**

- `src/gtfs/translations.ts`: the two functions above. `checkTranslationRow` treats `feed_info` as always valid; otherwise checks non-empty `record_id` / `field_value` with the exact messages in the test.
- `src/gtfs/schema.ts`: add `checkRow?` to `TableDef`; append to `GTFS_TABLES`:
  `{table: 'translations', file: 'translations.txt', requiredFile: false, columns: [text('table_name', true), text('field_name', true), text('language', true), text('translation', true), text('record_id'), text('record_sub_id'), text('field_value')], indexes: [['table_name', 'field_name', 'language', 'record_id', 'record_sub_id'], ['table_name', 'field_name', 'language', 'field_value']], checkRow: checkTranslationRow}`.
- `src/worker/table-writer.ts` `write()`: after the ragged-row check, if `def.checkRow` returns a message, add `{severity: 'error', file: def.file, line, column: null, code: 'invalid_value', message}` and return without inserting or counting. `get(column)` reads `(fields[positions.get(column)] ?? '').trim()`, `''` for absent columns.
- `src/worker/loader.ts` header branch: when `def?.table === 'translations' && isLegacyTranslationsHeader(header)`, add the `legacy_translations` warning (`file: name, line: 1, column: null`) and leave `writer` null.
- `src/shared/types.ts`: add `'legacy_translations'` to `IssueCode`.

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test`
Expected: all pass (existing tests unaffected — `SAMPLE_FEED` has no `translations.txt`).

- [ ] **Step 6: Commit**

```bash
git add src/gtfs src/worker/table-writer.ts src/worker/loader.ts src/worker/loader_test.ts src/shared/types.ts src/test-fixtures/sample-feed.ts
git commit -m "feat: import GTFS translations.txt"
```

---

### Task 2: Feed languages

**Files:**
- Modify: `src/worker/derive.ts` (`buildSummary`), `src/worker/queries.ts`, `src/worker/feed-service.ts`, `src/shared/types.ts`
- Test: `src/worker/queries_test.ts`

**Interfaces:**
- Consumes: `translations` table (Task 1).
- Produces: `interface FeedLanguages {readonly languages: readonly string[]; readonly originalLanguage: string | null}` in `src/shared/types.ts`.
- Produces: `getFeedLanguages(db: Database): FeedLanguages` in `queries.ts`; `FeedService.getFeedLanguages(feedId: string): FeedLanguages`.
- Produces `feed_summary` keys: `languages` (JSON array) and `original_language` (omitted when none).

- [ ] **Step 1: Write failing tests** (`src/worker/queries_test.ts`, new `describe('getFeedLanguages')`)

```ts
it('lists the original language first, then translations sorted, de-duplicated by case', async () => {
  const {db} = await loadSampleDb(TRANSLATED_FEED);
  expect(getFeedLanguages(db)).toEqual({languages: ['en', 'DE', 'fr'], originalLanguage: 'en'});
});
it('has no original language for mul or missing feed_lang', async () => {
  const mul = withFile('feed_info.txt', 'feed_publisher_name,feed_publisher_url,feed_lang\nP,https://example.com,mul\n');
  expect(getFeedLanguages((await loadSampleDb({...mul, 'translations.txt': SAMPLE_TRANSLATIONS})).db)).toEqual({
    languages: ['DE', 'fr'],
    originalLanguage: null,
  });
  const none = {...withoutFile('feed_info.txt'), 'translations.txt': SAMPLE_TRANSLATIONS};
  expect(getFeedLanguages((await loadSampleDb(none)).db).originalLanguage).toBeNull();
});
it('keeps the original spelling when a translation repeats it in another case', async () => {
  const files = {...TRANSLATED_FEED, 'translations.txt': 'table_name,field_name,language,translation,record_id\nstops,stop_name,EN,X,STN\n'};
  expect(getFeedLanguages((await loadSampleDb(files)).db).languages).toEqual(['en']);
});
it('reports no languages for a feed imported before translations existed', async () => {
  const {db} = await loadSampleDb();
  db.exec("DELETE FROM feed_summary WHERE key IN ('languages', 'original_language'); DROP TABLE translations;");
  expect(getFeedLanguages(db)).toEqual({languages: [], originalLanguage: null});
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/worker/queries_test.ts` → FAIL, `getFeedLanguages` not exported.

- [ ] **Step 3: Implement**

- `buildSummary`: original = `feed_info.feed_lang` when non-empty and not `mul` (case-insensitive). Others = `SELECT DISTINCT language FROM translations`, sorted by lowercase, dropping any whose lowercase equals one already kept. Insert `languages` = `JSON.stringify([original?, ...others])`, and `original_language` when there is one.
- `getFeedLanguages` reads only `feed_summary` (never `translations`); a missing/invalid `languages` value yields `[]`.
- `FeedService.getFeedLanguages(feedId)` delegates.

- [ ] **Step 4: Run, verify pass** — `npm test` → all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat: report a feed's available languages"`

---

### Task 3: Translated queries

**Files:**
- Create: `src/worker/translate.ts`
- Modify: `src/worker/queries.ts`, `src/worker/feed-service.ts`, `src/shared/types.ts`, `src/ui/*.tsx` and `src/app.tsx` call sites (pass `null` for now so the app compiles)
- Test: `src/worker/queries_test.ts`

**Interfaces:**
- Produces in `translate.ts`:
  - `type TranslatableTable = 'agency' | 'stops' | 'routes' | 'trips' | 'feed_info'`
  - `translated(table: TranslatableTable, field: string, alias: string, lang: string | null): string` — SQL expression; bare `${alias}.${field}` when `lang === null`.
  - `langParams(lang: string | null): Record<string, string>` — `{}` or `{$lang: lang}`.
- Produces `interface MapLabels {readonly routes: Readonly<Record<string, string>>; readonly stops: Readonly<Record<string, string>>}` in `src/shared/types.ts`.
- Produces (trailing `lang: string | null` on each): `getRoutes(db, lang)`, `getRouteDetail(db, routeId, lang)`, `getStopDetail(db, stopId, lang)`, `getStopDepartures(db, stopId, serviceDate, lang)`, `getFeedSummary(db, lang)`, new `getMapLabels(db, lang): MapLabels`; the same trailing parameter on the matching `FeedService` methods plus `FeedService.getMapLabels(feedId, lang)`.

- [ ] **Step 1: Write failing tests** (`src/worker/queries_test.ts`, new `describe('translated queries')` with `loadSampleDb(TRANSLATED_FEED)` in `beforeAll`)

```ts
it('translates stop names by id, by value, and falls back to the original', () => {
  const name = (id: string, lang: string | null) => getStopDetail(tdb, id, lang)?.stop.name;
  expect(name('STN', 'fr')).toBe('Gare Centrale');
  expect(name('NADAV', 'fr')).toBe('Avenue Nord / Avenue D');
  expect(name('STN_A', 'fr')).toBe('Quai A'); // id beats value; first duplicate wins
  expect(name('FUR', 'fr')).toBe('Furnace Creek'); // invalid rows skipped, empty translation ignored
  expect(name('STN', 'DE')).toBe('Zentralbahnhof');
  expect(name('STN', 'es')).toBe('Central Station');
  expect(name('STN', null)).toBe('Central Station');
});
it('translates route names, pattern headsigns and pattern stops', () => {
  expect(getRoutes(tdb, 'fr').find((r) => r.routeId === 'R10')?.longName).toBe('Aéroport - Centre');
  const detail = getRouteDetail(tdb, 'R10', 'fr');
  const outbound = detail?.patterns.find((p) => p.directionId === 0);
  expect(outbound?.headsign).toBe('Centre');
  expect(outbound?.stops.map((s) => s.name)).toEqual(['Aéroport de Beatty', 'Avenue Nord / Avenue D', 'Quai A']);
});
it('translates departure headsigns at a parent station', () => {
  const byTrip = new Map(getStopDepartures(tdb, 'STN', '20261012', 'fr').map((d) => [d.tripId, d.headsign]));
  expect(byTrip.get('T10_1')).toBe('Centre');
  expect(byTrip.get('T20_1')).toBe('Furnace Creek');
});
it('translates agency and publisher names', () => {
  const summary = getFeedSummary(tdb, 'fr');
  expect(summary.agencies[0]?.name).toBe('Régie de transport démo');
  expect(summary.feedInfo?.publisherName).toBe('Éditeur démo');
});
it('builds map labels', () => {
  const labels = getMapLabels(tdb, 'fr');
  expect(labels.routes['R10']).toBe('10 · Aéroport - Centre');
  expect(labels.stops['STN']).toBe('Gare Centrale');
  expect(labels.stops['STN_A']).toBe('Quai A');
});
it('runs untranslated queries on a DB without a translations table', async () => {
  const {db: old} = await loadSampleDb();
  old.exec('DROP TABLE translations');
  expect(getStopDetail(old, 'STN', null)?.stop.name).toBe('Central Station');
  expect(getRoutes(old, null)).toHaveLength(3);
});
```

Update existing calls in `queries_test.ts` to pass `null`.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/worker/queries_test.ts` → FAIL (`getMapLabels` missing; translated names wrong).

- [ ] **Step 3: Implement `translate.ts`**

Record keys: `agency → agency_id`, `stops → stop_id`, `routes → route_id`, `trips → trip_id`, `feed_info → none`. Table and field names are code constants and may be inlined; the language is always the bound `$lang`. For a keyed table:

```sql
COALESCE(
  (SELECT tr.translation FROM translations tr
   WHERE tr.table_name = '<table>' AND tr.field_name = '<field>' AND tr.language = $lang
     AND tr.record_id = <alias>.<key> AND tr.translation IS NOT NULL
   ORDER BY tr.rowid LIMIT 1),
  (SELECT ... same, but AND tr.field_value = <alias>.<field> ...),
  <alias>.<field>)
```

`feed_info` uses one subquery with no key condition.

- [ ] **Step 4: Rewrite the queries**

- `ROUTE_COLUMNS` becomes `routeColumns(lang: string | null): string`; the two name columns use `translated('routes', ...) AS route_short_name` / `AS route_long_name`.
- Every query that embeds `translated(...)` uses `$name` parameters only (sqlite-wasm cannot mix positional and named binds) and binds `{...langParams(lang), $stopId: stopId, ...}`. `DEPARTURES_SQL` becomes a function of `lang` with `$stopId`, `$serviceIds`, `$minSecs`.
- `getRouteDetail` patterns: `LEFT JOIN trips t ON t.trip_id = p.rep_trip_id` and select `translated('trips', 'trip_headsign', 't', lang) AS headsign`.
- `getMapLabels`: routes from `getRoutes(db, lang)` keyed by id with `routeLabel`; stops with the same `WHERE` as `getStopsGeoJSON`, name translated, falling back to the id.
- `getRouteShapesGeoJSON` calls `getRoutes(db, null)`; the GeoJSON functions stay untranslated.
- `FeedService`: thread `lang` through; add `getMapLabels(feedId, lang)`.
- UI call sites: pass `null` for now (Task 5 wires the real value). `npx tsc -b` must pass.

- [ ] **Step 5: Run, verify pass** — `npm test` and `npx tsc -b` → pass.

- [ ] **Step 6: Commit** — `git commit -m "feat: translate feed text at query time"`

---

### Task 4: Language in the URL and its resolution

**Files:**
- Create: `src/state/resolve-language.ts`, `src/state/resolve-language_test.ts`
- Modify: `src/state/url-state.ts`
- Test: `src/state/url-state_test.ts`

**Interfaces:**
- Consumes: `FeedLanguages` (Task 2).
- Produces: `Selection.lang: string | null`; `ORIGINAL_LANGUAGE = 'original'` exported from `resolve-language.ts`.
- Produces: `interface ResolvedLanguage {readonly display: string | null; readonly query: string | null}` and `resolveLanguage(requested: string | null, browserLanguages: readonly string[], feed: FeedLanguages): ResolvedLanguage`. `display` is for the map (translation or original); `query` is for the worker (`null` = original text).

- [ ] **Step 1: Write failing tests**

`url-state_test.ts`: add `lang: null` to existing expected selections; add:

```ts
it('round-trips lang and keeps it when switching feeds', () => {
  expect(parseSelection('?feed=a&lang=fr').lang).toBe('fr');
  expect(serializeSelection({...EMPTY_SELECTION, feed: 'a', lang: 'fr'})).toBe('?feed=a&lang=fr');
  const current = {feed: 'a', route: 'R', stop: 'S', date: '20261012', lang: 'fr'};
  expect(applyPatch(current, {feed: 'b'})).toEqual({feed: 'b', route: null, stop: null, date: null, lang: 'fr'});
});
```

`resolve-language_test.ts`, with `const feed = {languages: ['en', 'DE', 'fr'], originalLanguage: 'en'}`:

```ts
it.each([
  ['fr', ['en-US'], {display: 'fr', query: 'fr'}],
  ['de', [], {display: 'DE', query: 'DE'}], // feed's spelling
  ['es', ['fr-CA', 'en'], {display: 'fr', query: 'fr'}], // unavailable request → browser, base-language match
  [null, ['en-GB'], {display: 'en', query: null}],
  [null, ['ja'], {display: 'en', query: null}],
  ['en', ['fr'], {display: 'en', query: null}], // explicit original beats browser
  ['original', ['fr'], {display: 'en', query: null}],
])('resolves %s with browser %j', (requested, browser, expected) => {
  expect(resolveLanguage(requested, browser, feed)).toEqual(expected);
});
it('matches a regional feed language from a base browser language', () => {
  expect(resolveLanguage(null, ['fr'], {languages: ['fr-CA'], originalLanguage: null})).toEqual({display: 'fr-CA', query: 'fr-CA'});
});
it('shows original text for a multilingual feed when asked', () => {
  expect(resolveLanguage('original', ['fr'], {languages: ['fr'], originalLanguage: null})).toEqual({display: null, query: null});
});
it('resolves to nothing for a feed without languages', () => {
  expect(resolveLanguage('fr', ['fr'], {languages: [], originalLanguage: null})).toEqual({display: null, query: null});
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/state` → FAIL.

- [ ] **Step 3: Implement**

- `url-state.ts`: `lang` in `Selection`, `EMPTY_SELECTION`, parse/serialize (after `date`); `applyPatch` keeps `current.lang` when switching feeds.
- `resolveLanguage`: codes compare case-insensitively; the returned code is the feed's spelling. Order: `original` → original; exact match of `requested`; then for each browser language in order, an exact match, else the first feed language with the same primary subtag (text before the first `-`); else original. `query` is `null` when the match equals `originalLanguage` (case-insensitive) or there is no match.

- [ ] **Step 4: Run, verify pass** — `npm test` → pass.

- [ ] **Step 5: Commit** — `git commit -m "feat: keep the chosen language in the URL and resolve it per feed"`

---

### Task 5: Language selector and translated sidebar

**Files:**
- Create: `src/ui/language-select.tsx`
- Modify: `src/ui/format.ts`, `src/ui/format_test.ts`, `src/app.tsx`, `src/ui/route-detail.tsx`, `src/ui/stop-detail.tsx`, `e2e/helpers.ts`, `e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `getFeedLanguages` (Task 2), `lang` parameters (Task 3), `resolveLanguage`, `ORIGINAL_LANGUAGE`, `Selection.lang` (Task 4).
- Produces: `languageName(code: string): string` in `format.ts`.
- Produces: `LanguageSelect(props: {readonly languages: FeedLanguages; readonly value: string | null; readonly onChange: (lang: string) => void}): ReactElement | null` — renders nothing when no language other than the original exists.
- Produces in `e2e/helpers.ts`: `uploadTranslatedSample(page: Page): Promise<void>` — uploads `TRANSLATED_FEED` as `demo-translated.zip`, waits for `feed=file-demo-translated`.

- [ ] **Step 1: Write failing tests**

`format_test.ts`:

```ts
it('names languages in their own language, falling back to the code', () => {
  expect(languageName('fr')).toBe('français');
  expect(languageName('not a code!')).toBe('not a code!');
});
```

`e2e/explorer.spec.ts`:

```ts
test('shows a feed in a chosen language and keeps it on reload', async ({page}) => {
  await page.goto('/');
  await uploadTranslatedSample(page);
  const language = page.getByRole('combobox', {name: 'Language'});
  await expect(language).toHaveValue('original');
  await language.selectOption('fr');
  await expect(page).toHaveURL(/lang=fr/);
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('button', {name: '10 · Aéroport - Centre'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', {name: 'Language'})).toHaveValue('fr');
  await expect(sidebar.getByRole('button', {name: '10 · Aéroport - Centre'})).toBeVisible();
});

test('has no language selector for a feed without translations', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  await expect(page.getByRole('combobox', {name: 'Language'})).toHaveCount(0);
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/ui/format_test.ts` and `npx playwright test -g "language"` → FAIL.

- [ ] **Step 3: Implement**

- `languageName`: `new Intl.DisplayNames([code], {type: 'language'}).of(code)` in try/catch; the code when it throws or returns undefined.
- `LanguageSelect`: first option value `ORIGINAL_LANGUAGE`, label `${languageName(original)} (original)` or `Feed default`; then one option per non-original language, value = feed spelling, label `languageName(code)`. Its `value` prop is the resolved `query ?? ORIGINAL_LANGUAGE`.
- `Explorer` (`app.tsx`): load `getFeedLanguages` for the active feed with `useAsync` (deps `[service, activeFeedId]`); show `Opening feed…` until it resolves so views never query once in the wrong language; compute `resolveLanguage(selection.lang, navigator.languages, languages)`; render `LanguageSelect` in `.app-header`, `onChange={(lang) => update({lang}, {replace: true})}`; pass `resolved.query` as `lang` to `FeedContent`. (`MapView` gets `resolved` in Task 6.)
- `FeedContent`, `RouteDetailView`, `StopDetailView`: add `lang: string | null`, pass it to every service call and add it to each `useAsync` deps array.

- [ ] **Step 4: Run, verify pass** — `npm test`, `npm run e2e`, `npx tsc -b`, `npm run lint` → pass.

- [ ] **Step 5: Commit** — `git commit -m "feat: add language selector and translated sidebar"`

---

### Task 6: Map language and translated tooltips

**Files:**
- Modify: `src/map/adapter.ts`, `src/map/mapbox-adapter.ts`, `src/map/fake-adapter.ts`, `src/map/map-view.tsx`, `src/app.tsx`, `e2e/helpers.ts`, `e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `ResolvedLanguage` (Task 4), `getMapLabels` / `MapLabels` (Task 3).
- Produces: `MapAdapter.setLanguage(lang: string | null): void`; fake `data-state` gains `language: string | null` (initially `null`); `FakeMapState.language: string | null` in `e2e/helpers.ts`.
- Produces: `MapViewProps.language: ResolvedLanguage`.

- [ ] **Step 1: Extend the E2E test** — in `shows a feed in a chosen language…`, after selecting French:

```ts
await expect.poll(async () => (await fakeMapState(page)).language).toBe('fr');
```

and before selecting (Playwright's default locale is `en-US`): `expect.poll(...).toBe('en')`.

- [ ] **Step 2: Run, verify fail** — `npx playwright test -g "chosen language"` → FAIL (`language` undefined).

- [ ] **Step 3: Implement**

- `app.tsx`: pass `language={resolved}` to `MapView`.
- Mapbox adapter: `this.map.setLanguage(lang ?? undefined)` (no argument restores Mapbox's default local names).
- Fake adapter: store `language` in state and re-render.
- `MapView`: effect `adapter?.setLanguage(language.display)` on `[adapter, language.display]`; a separate effect loads `service.getMapLabels(feedId, language.query)` into `labels` state when both are non-null and clears it otherwise. It must not touch the GeoJSON effect, so a language change never re-fits bounds. The hover handler shows `labels.stops[stopId]` / `labels.routes[routeId]` when present, else the feature's `name`.

- [ ] **Step 4: Run, verify pass** — `npm run e2e`, `npm test`, `npx tsc -b`, `npm run lint` → pass.

- [ ] **Step 5: Check on the real map** — `npm run dev` with `VITE_MAPBOX_TOKEN` set; upload `TRANSLATED_FEED` (or a real feed with translations), switch to French, confirm base-map labels change to French and a route tooltip shows `10 · Aéroport - Centre`; switch back to the original and confirm labels return.

- [ ] **Step 6: Commit** — `git commit -m "feat: drive map labels and tooltips from the chosen language"`

---

### Task 7: Performance check and docs

**Files:**
- Modify: `scripts/perf-import.ts`, `docs/perf-baseline.md`, `CLAUDE.md`

- [ ] **Step 1: Extend `scripts/perf-import.ts`** — after the import table, call `getFeedLanguages(db)`; if a non-original language exists, find the busiest stop (`SELECT stop_id FROM stop_times GROUP BY stop_id ORDER BY count(*) DESC LIMIT 1`) and print a second `console.table` with milliseconds for `getMapLabels` and `getStopDepartures` (date = `feed_summary` `service_start`) with `null` and with that language. Otherwise print `No translations in this feed.`

- [ ] **Step 2: Run it** — `npm run perf -- <feed with translations.txt>`; expected: both tables print, no errors. Then `npm run perf -- <feed without>` prints the import table and `No translations in this feed.`

- [ ] **Step 3: Record** the translated timings in `docs/perf-baseline.md` (feed name, date, machine, the four numbers). If no feed with translations is at hand, record "not measured" and say so in the PR.

- [ ] **Step 4: Update `CLAUDE.md`** — in the Queries paragraph, add one sentence: name-returning queries take a trailing `lang` and wrap columns with `translated(...)` from `src/worker/translate.ts`, binding `$lang` (named parameters only in those queries); `getFeedLanguages` reads only `feed_summary` so it works on feeds imported before translations existed.

- [ ] **Step 5: Commit** — `git commit -m "docs: record translated query timings; note translation helper"`
