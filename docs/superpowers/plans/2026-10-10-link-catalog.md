# Link Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the R2 mirror with a build-time catalog of links (Mobility Database + curated featured entries) that users import directly, with their own API key, or by downloading and uploading a file.

**Architecture:** A Node script (`npm run catalog:sync`) turns Mobility Database's `feeds_v2.csv` plus `catalog/catalog.json` into `public/catalog.json`, shipped with the app. Shared, dependency-free modules in `src/catalog/` define entries, build keyed requests, search, store keys, and check for updates. The worker imports catalog entries (keyed or not, or from a user-supplied file) and records `ETag`/`Last-Modified`; the picker gains featured/search/access-specific rows.

**Tech Stack:** TypeScript, React 19, sqlite-wasm worker (Comlink), Node ≥ 24 scripts (type stripping), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-link-catalog-design.md`

## Global Constraints

- Mobility Database CSV URL: `https://files.mobilitydatabase.org/feeds_v2.csv`; keep rows with `data_type = gtfs` and `status` `active` or empty.
- App catalog path: `/catalog.json` (`public/catalog.json`, git-ignored); fallback snapshot `catalog/mdb-snapshot.json` (committed).
- Access kinds `direct` / `key` / `download`; badges "Direct", "Key required", "Download manually".
- Key storage: `localStorage` key `gtfs-visualizer:key:<provider>`; keys never appear in messages, import issues, logs, or the app URL; shown URLs are origin + path only.
- Key query parameter is appended verbatim as `<queryParam>=<encodeURIComponent(key)>` (the parameter name is not encoded — ODPT's is `acl:consumerKey`).
- Accessible names: searchbox "Search feeds"; buttons "Import <name>", "Save key and import <name>", "Forget key for <provider>"; link "Download <name>"; file input "Upload downloaded file for <name>".
- Search: NFKC → lowercase → NFD, strip U+0300–U+036F → NFC → katakana U+30A1–U+30F6 → hiragana (−0x60); whitespace split includes U+3000; max 50 results.
- `src/catalog/*.ts` (except UI-only `catalog.ts`, `key-store.ts`, `update-check.ts`) must stay dependency-free and importable by Node scripts; relative imports include `.ts`.
- Google TypeScript style per `CLAUDE.md`: named exports, no `any`, no non-null `!`, explicit return types on exports, kebab-case files; UI imports `src/worker` with `import type` only.
- E2E runs need `LD_LIBRARY_PATH=/tmp/claude-1000/-home-brian-gtfs-visualizer/594622e6-8ca3-44f3-92f5-169da943ff00/scratchpad/libs/usr/lib/x86_64-linux-gnu` prefixed in this environment.
- Commit messages end with a `Co-Authored-By: Claude <model> <noreply@anthropic.com>` line naming the model that wrote the commit.

## Review Focus

1. **Key leakage through error text** (a fetch error or HTTP failure whose message would include the keyed URL): messages show no key. Pinned in Task 3.
2. **Mobility Database changes its CSV columns** (a required column disappears): sync fails over to the committed snapshot with a warning instead of shipping an empty or broken catalog. Pinned in Task 2.
3. **An id in both the curated file and Mobility Database** (or a curated `mdbId` that no longer exists): the build fails naming the entry, rather than silently showing duplicates or dropping a featured feed. Pinned in Task 2.
4. **Several feeds share one provider key** (e.g. many ODPT feeds): saving a key on one row enables the others; "Forget key" clears it for all. Pinned in Task 6.
5. **Empty or whitespace-only search** (including a lone U+3000): shows no results and no "Showing N" note, only Featured. Pinned in Task 5.

---

### Task 1: Switch the app to the link-catalog format; remove the mirror

**Files:**
- Modify: `src/catalog/catalog-types.ts` (replace contents), `src/catalog/catalog.ts`, `src/catalog/catalog_test.ts`, `src/ui/feed-picker.tsx`, `src/app.tsx`, `src/vite-env.d.ts`, `.env.e2e`, `e2e/helpers.ts`, `e2e/explorer.spec.ts`, `package.json`
- Delete: `scripts/mirror/` (all files), `.github/workflows/mirror-catalog.yml`
- Test: `src/catalog/catalog-types_test.ts` (create), `src/catalog/catalog_test.ts`

**Interfaces:**
- Produces in `catalog-types.ts`:
  - `type Bbox = readonly [number, number, number, number]` (minLon, minLat, maxLon, maxLat)
  - `type Access = {readonly kind: 'direct'} | {readonly kind: 'key'; readonly provider: string; readonly signupUrl: string; readonly queryParam: string | null; readonly header: string | null} | {readonly kind: 'download'; readonly pageUrl: string | null}` (key: exactly one of `queryParam`/`header` non-null)
  - `interface CatalogEntry {readonly id: string; readonly name: string; readonly place: string; readonly url: string; readonly originalUrl: string | null; readonly access: Access; readonly license: string | null; readonly bbox: Bbox | null; readonly featured: boolean; readonly viaMobilityDatabase: boolean}`
  - `interface CatalogSnapshot {readonly generatedAt: string; readonly entries: readonly CatalogEntry[]}`
  - `type CuratedEntry = {readonly mdbId: string; readonly overrides: Readonly<Partial<Omit<CatalogEntry, 'id' | 'featured' | 'viaMobilityDatabase'>>>} | {readonly entry: CatalogEntry}`
  - `CATALOG_PATH = '/catalog.json'`, `ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/`
  - `parseAccess(json: unknown, where: string): Access`, `parseCuratedCatalog(json: unknown): CuratedEntry[]`, `parseCatalogSnapshot(json: unknown): CatalogSnapshot` — all throw `Error` whose message names the location (e.g. `catalog.json entry 2: "access.kind" must be direct, key, or download`).
- Produces in `catalog.ts`: `loadCatalog(fetchFn?: (url: string) => Promise<Response>): Promise<CatalogSnapshot>` (fetches `CATALOG_PATH`, `cache: 'no-cache'`).
- Produces in `e2e/helpers.ts`: `MockCatalogEntry = {readonly id: string; readonly name: string; readonly place: string; readonly zip: Buffer}`; `mockCatalog(context, entries)` serves `/catalog.json` (same origin, via `context.route('**/catalog.json')`) as a snapshot of `direct` featured entries with `url = https://feeds.test/<id>.zip`, and serves those zips with `access-control-allow-origin: *`.

- [ ] **Step 1: Write failing tests**

`catalog-types_test.ts` — `parseCuratedCatalog` accepts `[{mdbId: 'mdb-437'}, {mdbId: 'mdb-1', name: 'X'}, <full Tokyo Metro entry from the spec §4>]` → `[{mdbId: 'mdb-437', overrides: {}}, {mdbId: 'mdb-1', overrides: {name: 'X'}}, {entry: {...featured: true, viaMobilityDatabase: false, originalUrl: null, bbox: null, access: {kind: 'key', provider: 'odpt', signupUrl: 'https://developer.odpt.org/', queryParam: 'acl:consumerKey', header: null}}}]`. Rejections (assert `toThrow(/entry 1/)` and the field name): bad `id` pattern, missing `name`, `access.kind: 'magic'`, key access with both `queryParam` and `header`, key access with neither, non-array input. `parseCatalogSnapshot` round-trips a snapshot and rejects an entry without `url`.

`catalog_test.ts` — replace existing tests: `loadCatalog(fakeFetch)` requests `/catalog.json` and returns the parsed snapshot; a 500 response rejects with `HTTP 500`.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/catalog` → FAIL (exports missing).

- [ ] **Step 3: Implement**
  - `catalog-types.ts` per Interfaces (no imports).
  - `catalog.ts`: only `loadCatalog`; delete `fetchCatalog`, `CatalogFeed`, `isUpdateAvailable`.
  - `feed-picker.tsx`: drop the `catalogBaseUrl` prop; load with `useAsync(() => loadCatalog(), [])`; for now list only entries with `featured && access.kind === 'direct'`, each with button "Import <name>" starting `{kind: 'catalog', id: entry.id, name: entry.name, url: entry.url, sha256: null}` (the worker's existing shape — Task 3 replaces it). Remove the "Update available" badge and the "Not available in the catalog" disabling (Task 6 restores update badges). Catalog load error text: "The catalog is unavailable right now."
  - `app.tsx`: remove `CATALOG_BASE_URL` and the prop. `vite-env.d.ts` and `.env.e2e`: remove `VITE_CATALOG_BASE_URL`.
  - Delete `scripts/mirror/`, the workflow, the `mirror` npm script, and the `@aws-sdk/client-s3` devDependency (`npm uninstall @aws-sdk/client-s3`).
  - E2E: rewrite `mockCatalog` per Interfaces; update `imports a feed from the catalog` to `mockCatalog(context, [{id: 'demo-catalog', name: 'Demo Catalog Feed', place: 'Testland', zip: sampleZip()}])` (rest unchanged).

- [ ] **Step 4: Verify** — `npm test`, `npm run e2e`, `npx tsc -b`, `npm run lint` → pass.

- [ ] **Step 5: Commit** — `feat: switch to the link catalog format and remove the R2 mirror`

---

### Task 2: `catalog:sync` script

**Files:**
- Create: `scripts/catalog/csv.ts`, `scripts/catalog/mdb.ts`, `scripts/catalog/merge.ts`, `scripts/catalog/sync.ts`, tests `scripts/catalog/csv_test.ts`, `scripts/catalog/mdb_test.ts`, `scripts/catalog/merge_test.ts`; `catalog/mdb-snapshot.json` (generated)
- Modify: `catalog/catalog.json`, `package.json`, `.gitignore`

**Interfaces:**
- Consumes: `CatalogEntry`, `CuratedEntry`, `parseCuratedCatalog`, `CatalogSnapshot` (Task 1).
- Produces:
  - `parseCsv(text: string): string[][]` — RFC 4180 (quoted fields with commas, doubled quotes, CR/LF inside quotes), strips a leading BOM.
  - `MDB_REQUIRED_COLUMNS: readonly string[]` — the columns listed in spec §2.
  - `rowsFromCsv(text: string): Record<string, string>[]` — throws `Error('feeds_v2.csv is missing column <name>')` when a required column is absent.
  - `mapMobilityDatabaseRows(rows: readonly Record<string, string>[]): CatalogEntry[]` — spec §4 mapping (`featured: false`).
  - `mergeCatalog(mdb: readonly CatalogEntry[], curated: readonly CuratedEntry[]): CatalogEntry[]` — featured first in curated order (`featured: true`), then the remaining Mobility Database entries sorted by `name` (`localeCompare`, base sensitivity); throws `Error('catalog.json entry <i>: unknown mdbId "<id>"')` and `Error('catalog.json entry <i>: id "<id>" is already a Mobility Database feed')`.
  - CLI `node scripts/catalog/sync.ts [--update-snapshot] [--if-missing]`; the CSV URL defaults to the Global Constraints URL and can be overridden with env `CATALOG_MDB_URL` (used to test the fallback).

- [ ] **Step 1: Write failing tests**
  - `csv_test.ts`: `parseCsv('﻿a,b\n"x, y","say ""hi"""\n"multi\nline",z\r\n')` → `[['a','b'],['x, y','say "hi"'],['multi\nline','z']]`.
  - `mdb_test.ts` (rows built in the test, all required columns present, blanks as `''`):
    - inactive, `deprecated`, and `gtfs_rt` rows dropped; `status ''` kept;
    - auth `0` with `urls.latest` → `{kind: 'direct'}`, `url = latest`, `originalUrl = direct_download`, `viaMobilityDatabase: true`;
    - auth `1` with info + param → key with `provider = new URL(direct_download).host`, `queryParam`, `url = direct_download`, `viaMobilityDatabase: false`; auth `2` → `header`;
    - auth `1` missing param → `{kind: 'download', pageUrl: null}`; auth `0` without `urls.latest` → download;
    - name: provider only → provider; provider `明石市` + name `たこバス` → `明石市 — たこバス`; equal provider and name → one;
    - place `Akashi, Hyogo Prefecture, JP`; empty parts skipped;
    - bbox from four numeric columns as `[minLon, minLat, maxLon, maxLat]`, `null` if any is blank;
    - `rowsFromCsv` without `urls.latest` throws `/missing column urls.latest/`.
  - `merge_test.ts`: featured order and `featured: true`; override applied (`{mdbId: 'mdb-1', overrides: {name: 'Better'}}`); full entry inserted; rest sorted by name; unknown `mdbId` and id collision throw with the messages above.

- [ ] **Step 2: Run, verify fail** — `npx vitest run scripts/catalog` → FAIL.

- [ ] **Step 3: Implement `csv.ts`, `mdb.ts`, `merge.ts`** per Interfaces.

- [ ] **Step 4: Implement `sync.ts`** — reads and validates `catalog/catalog.json` (validation error → exit 1 with the message); downloads the CSV (`AbortSignal.timeout(60_000)`) → `rowsFromCsv` → map; on any download/parse error prints `catalog:sync: using catalog/mdb-snapshot.json (<reason>)` to stderr and reads the snapshot (if that is missing too → exit 1); merges; writes `public/catalog.json` as `{generatedAt: new Date().toISOString(), entries}`; `--update-snapshot` (only after a successful download) also writes the mapped Mobility Database entries to `catalog/mdb-snapshot.json` (`JSON.stringify(entries)` — one line, small); `--if-missing` exits 0 immediately when `public/catalog.json` exists. Prints `catalog:sync: <n> feeds (<featured> featured)`.

- [ ] **Step 5: Wire up** — `package.json`: `"catalog:sync": "node scripts/catalog/sync.ts"`, `"build": "npm run catalog:sync && tsc -b && vite build"`, `"dev": "node scripts/catalog/sync.ts --if-missing && vite"`; `.gitignore`: `public/catalog.json`. `catalog/catalog.json`:

```json
[
  {"mdbId": "mdb-437"},
  {"mdbId": "mdb-3520"},
  {
    "id": "tokyo-metro",
    "name": "Tokyo Metro",
    "place": "Tokyo, Japan",
    "url": "https://api.odpt.org/api/v4/files/TokyoMetro/data/TokyoMetro-Train-GTFS.zip",
    "access": {"kind": "key", "provider": "odpt", "signupUrl": "https://developer.odpt.org/", "queryParam": "acl:consumerKey"},
    "license": "https://developer.odpt.org/terms/data_basic_license.html"
  }
]
```

- [ ] **Step 6: Generate and check** — `node scripts/catalog/sync.ts --update-snapshot` → prints ~2,840 feeds (3 featured), writes both files; report `public/catalog.json` and snapshot sizes in the task report. Then simulate an outage: `CATALOG_MDB_URL=https://files.mobilitydatabase.org/does-not-exist.csv node scripts/catalog/sync.ts` → the fallback warning is printed and the same entry count comes from the snapshot.

- [ ] **Step 7: Verify** — `npm test`, `npx tsc -b`, `npm run lint`, `npm run build` → pass.

- [ ] **Step 8: Commit** — `feat: build the catalog from Mobility Database and curated entries` (include `catalog/mdb-snapshot.json`).

---

### Task 3: Worker imports for catalog entries, keys, and validators

**Files:**
- Create: `src/catalog/feed-request.ts`, `src/catalog/feed-request_test.ts`
- Modify: `src/shared/types.ts`, `src/worker/feed-service.ts`, `src/worker/feed-service_test.ts`, `src/ui/feed-picker.tsx` (adapt the Task 1 call), `src/ui/feed-info.tsx` (if it reads `catalogSha256`)

**Interfaces:**
- Consumes: `CatalogEntry`, `Access` (Task 1).
- Produces in `feed-request.ts` (dependency-free):
  - `buildFeedRequest(entry: CatalogEntry, key: string | null): {readonly url: string; readonly headers: Readonly<Record<string, string>>}` — for key access with a key: query param appended (`?` or `&`), or the header set; otherwise `entry.url`, no headers.
  - `redactUrl(url: string): string` — origin + pathname; returns the input unchanged if it doesn't parse.
- Produces in `types.ts`:
  - `ImportSource = {readonly kind: 'catalog'; readonly entry: CatalogEntry; readonly key: string | null} | {readonly kind: 'catalog-file'; readonly entry: CatalogEntry; readonly file: File} | {readonly kind: 'url'; readonly url: string} | {readonly kind: 'file'; readonly file: File}`
  - `ImportErrorCode` adds `'key_rejected' | 'blocked'`
  - `FeedRecord`: remove `catalogSha256`; add `sourceEtag: string | null`, `sourceLastModified: string | null`, `license: string | null`, `viaMobilityDatabase: boolean`.
- `meta.db` `feeds` gains `source_etag TEXT`, `source_last_modified TEXT`, `license TEXT`, `via_mdb INTEGER NOT NULL DEFAULT 0` (added in `init()` when missing; `catalog_sha256` left in place, unused).

- [ ] **Step 1: Write failing tests**
  - `feed-request_test.ts`: direct → `{url: entry.url, headers: {}}`; key/queryParam on `https://api.test/f.zip` with key `a b` → `https://api.test/f.zip?acl:consumerKey=a%20b`; on `https://api.test/f.zip?x=1` → `...?x=1&acl:consumerKey=a%20b`; key/header → `headers: {'X-Api-Key': 'k'}`, URL unchanged; key access with `null` key → plain URL; `redactUrl('https://api.test/f.zip?acl:consumerKey=SECRET')` → `https://api.test/f.zip`.
  - `feed-service_test.ts` (replace the three old catalog tests; fake `fetch` records `(url, init)`):
    - catalog direct import: saved as `{id: entry.id, name: entry.name, sourceKind: 'catalog', sourceRef: entry.id, viaMobilityDatabase: true, license}`; `init.cache === 'no-cache'`; response headers `etag: "\"abc\""`, `last-modified: Mon, 05 Oct 2026 18:31:43 GMT` saved as `sourceEtag`/`sourceLastModified`;
    - keyed import calls the URL with the key and saves no key anywhere (assert `JSON.stringify(service.listFeeds())` does not contain the key);
    - 401 on a key entry → `{ok: false, code: 'key_rejected'}`, message `The provider rejected this key.`; 403 likewise; 404 → `code: 'http'`;
    - fetch throwing `TypeError` on a catalog entry → `code: 'blocked'`; no failure message for any case contains the key or `consumerKey`;
    - `catalog-file` import → catalog id/name, `sourceEtag: null`;
    - migration: create `feeds` with the old column set and one row, then `init()` → `listFeeds()` returns the row with the new fields `null`/`false`;
    - the existing "upload does not replace a catalog feed" test adapted to the new source shape.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/catalog/feed-request_test.ts src/worker/feed-service_test.ts` → FAIL.

- [ ] **Step 3: Implement**
  - `acquire()` handles `catalog` (fetch `buildFeedRequest` result with `cache: 'no-cache'` and the headers) and `catalog-file`; both use `entry.id` as id and `entry.name` as fixed name.
  - Catalog failure mapping: thrown `TypeError` before a response → `blocked` with message `Your browser couldn't download this feed directly.`; 401/403 on key access → `key_rejected`; other non-OK → `http` (`The server responded with HTTP <status>.`). URL imports keep today's messages. No message may include a URL with a query string — use `redactUrl` if a URL is ever shown.
  - Record `etag`/`last-modified` from the final response, plus `license`/`via_mdb` from the entry (null/false for `url`/`file`).
  - `init()`: `PRAGMA table_info(feeds)`; `ALTER TABLE feeds ADD COLUMN ...` for each missing column.
  - `feed-picker.tsx`: start `{kind: 'catalog', entry, key: null}`.

- [ ] **Step 4: Verify** — `npm test`, `npm run e2e`, `npx tsc -b`, `npm run lint` → pass.

- [ ] **Step 5: Commit** — `feat: import catalog entries with optional keys and record source validators`

---

### Task 4: Key store and update checks

**Files:**
- Create: `src/catalog/key-store.ts`, `src/catalog/key-store_test.ts`, `src/catalog/update-check.ts`, `src/catalog/update-check_test.ts`

**Interfaces:**
- Consumes: `buildFeedRequest` (Task 3), `CatalogEntry`, `FeedRecord`.
- Produces:
  - `getKey(provider: string, storage?: () => Storage): string | null`, `setKey(provider: string, key: string, storage?: () => Storage): void`, `forgetKey(provider: string, storage?: () => Storage): void` — storage key `gtfs-visualizer:key:<provider>`; every access in try/catch (get → null, set/forget → no-op); `setKey` trims and ignores empty keys.
  - `type UpdateStatus = 'update' | 'current' | 'unknown'`; `checkForUpdate(entry: CatalogEntry, record: FeedRecord, key: string | null, fetchFn?: (url: string, init: RequestInit) => Promise<Response>): Promise<UpdateStatus>`.

- [ ] **Step 1: Write failing tests** — key store: round trip; separate providers independent; forget; empty/whitespace key not stored; throwing storage → `getKey` null and no throw (same `memoryStorage`/`throwingStorage` helpers as `src/map/light-setting_test.ts`). Update check (fake fetch asserting `init.method === 'HEAD'` and keyed URL): same ETag → `current`; different → `update`; `W/"abc"` vs `"abc"` → `current`; no ETag on either side, Last-Modified differs → `update`; record without validators → `unknown` and fetch not called; `download` access → `unknown`, not called; key access with `null` key → `unknown`, not called; fetch throws → `unknown`; 405 → `unknown`; response without either header → `unknown`.

- [ ] **Step 2: Run, verify fail.** **Step 3: Implement.** **Step 4: Verify** — `npm test`, `npx tsc -b`, `npm run lint`.

- [ ] **Step 5: Commit** — `feat: store provider keys and check catalog feeds for updates`

---

### Task 5: Catalog search

**Files:**
- Create: `src/catalog/search.ts`, `src/catalog/search_test.ts`

**Interfaces:**
- Produces: `normalizeForSearch(text: string): string`; `searchCatalog(entries: readonly CatalogEntry[], query: string, limit?: number): {readonly results: readonly CatalogEntry[]; readonly total: number}` (default limit 50).

- [ ] **Step 1: Write failing tests**
  - `normalizeForSearch`: `'Zürich'` → `'zurich'`; `'ＭＢＴＡ'` → `'mbta'`; `'ミヨシ'` → `'みよし'`; `'バス'` → `'ばす'` (voiced mark kept, not `'はす'`); half-width `'ﾊﾞｽ'` → `'ばす'`.
  - `searchCatalog` over a small fixture (MBTA in Boston; `明石市 — たこバス/たこバスミニ` in `Akashi, Hyogo Prefecture, JP`; `Zürich VBZ`; 60 entries named `Bus <n>`):
    - `'boston mbta'` finds MBTA; `'zurich'` finds Zürich; `'明石'` and `'akashi'` and `'タコ'` find the Akashi feed; `'明石　たこ'` (U+3000) finds it;
    - a name match ranks above a place-only match (fixture: entry named `Akashi Ferry` in another place vs the Akashi feed whose place matches) — name match first;
    - `'bus'` → 50 results, `total` 61 or more;
    - `''`, `'   '`, `'　'` → `{results: [], total: 0}`.

- [ ] **Step 2: Run, verify fail.** **Step 3: Implement** (normalize each entry's `name`, `place`, `id` once per call; tokens must each be a substring of some field). **Step 4: Verify.**

- [ ] **Step 5: Commit** — `feat: search the catalog across scripts`

---

### Task 6: Picker UI, update badges, feed details

**Files:**
- Create: `src/ui/catalog-row.tsx`
- Modify: `src/ui/feed-picker.tsx`, `src/ui/feed-info.tsx`, `src/index.css`, `e2e/helpers.ts`, `e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `loadCatalog`, `searchCatalog`, `getKey`/`setKey`/`forgetKey`, `checkForUpdate`, `ImportSource` variants, `ImportErrorCode` `key_rejected`/`blocked`.
- Produces: `CatalogRow(props: {readonly entry: CatalogEntry; readonly busy: boolean; readonly onImport: (source: ImportSource) => void; readonly failure: ImportFailure | null}): ReactElement`.
- `e2e/helpers.ts`: `MockCatalogEntry` gains optional `access` (default direct), `etag` (served on GET and HEAD), and `blockDirect` (route aborts the zip request, simulating CORS); keyed entries' zips are only served when the request carries `acl:consumerKey=<key>` — 401 otherwise.

- [ ] **Step 1: Write failing E2E tests** (each with `mockCatalog` as needed):
  - direct import by "Import <name>" (existing test still passes);
  - key flow: keyed entry `Keyed Feed` (provider `odpt`) → signup link visible, fill key field, click "Save key and import Keyed Feed" → feed opens; "Change feed" → button "Forget key for odpt" visible; a second keyed entry with the same provider shows "Import <name>" without asking (Review Focus 4); clicking "Forget key for odpt" brings the key field back on both;
  - wrong key → message `The provider rejected this key.` and the key field shown again;
  - `blockDirect` entry → after "Import <name>", the row shows "Download <name>" and "Upload downloaded file for <name>"; uploading `sampleZip()` there opens the feed under the catalog name (URL `feed=<id>`);
  - search: entries `明石市 — たこバス` (place `Akashi, Hyogo Prefecture, JP`, not featured) and others → typing `明石` and then `akashi` in "Search feeds" shows it; whitespace-only shows no results and no "Showing" note;
  - update badge: import a featured entry served with ETag `"v1"`, change the mock to `"v2"`, reopen the picker → "Update available" visible; with `"v1"` unchanged it is not.

- [ ] **Step 2: Run, verify fail** — `npx playwright test` (with the library prefix) → new tests fail.

- [ ] **Step 3: Implement**
  - Picker: "Featured" (all `featured` entries) then the search box (debounced 150 ms) and up to 50 results with "Showing 50 of <total> — refine your search" when `total > 50`. Rows rendered by `CatalogRow`.
  - `CatalogRow`: name, place, badge text by kind; actions per spec §5 table and Global Constraints names; key field (`type="password"`, `autocomplete="off"`, label "API key for <provider>"), signup link "Get a key"; on `blocked` the row switches to the download layout; on `key_rejected` the key field reopens. Keys read via `getKey(entry.access.provider)` at render; after "Forget key" all rows re-render (lift a `keysVersion` counter into the picker).
  - Saved-feed list: for saved catalog feeds whose `sourceRef` is in the snapshot, run `checkForUpdate` with `getKey` (max 4 concurrent, cached in component state keyed by feed id + importedAt); `update` → "Update available" badge and the existing re-import button (re-import uses the same source as the row's import).
  - `feed-info.tsx`: for `sourceKind === 'catalog'`, a line "Data: <agency> · License" (link `record.license` when set) and " · via Mobility Database" when `viaMobilityDatabase`.
  - CSS for badges and expanded rows, consistent with existing `.badge`/`.notice`.

- [ ] **Step 4: Verify** — `npm test`, `npm run e2e`, `npx tsc -b`, `npm run lint` → pass. Then a manual check with the real catalog: `npm run catalog:sync`, `npm run dev`, import Oswego County (direct) in a browser; report the outcome.

- [ ] **Step 5: Commit** — `feat: catalog picker with search, keys, download fallback, and update badges`

---

### Task 7: Documentation

**Files:**
- Modify: `docs/deploy.md`, `CLAUDE.md`, `README.md` (only if it mentions the mirror or `VITE_CATALOG_BASE_URL`)

- [ ] **Step 1: `docs/deploy.md`** — remove sections 1–2 (R2, GitHub secrets) and `VITE_CATALOG_BASE_URL` from Pages env vars; replace "Maintaining the catalog" with: curated entry formats (reference with overrides, full entry, access kinds), `npm run catalog:sync` (runs in `npm run build`; needs network; falls back to the committed snapshot), refreshing `catalog/mdb-snapshot.json` with `--update-snapshot` and committing it, and a note that Mobility Database metadata is CC0 while each feed keeps its own license.

- [ ] **Step 2: `CLAUDE.md`** — Commands: replace `npm run mirror` with `npm run catalog:sync` (`--update-snapshot`); Architecture "Catalog" paragraph rewritten for the link catalog (sources, snapshot, access kinds, keys in `localStorage` passed via `ImportSource`, `ETag`/`Last-Modified` update checks, `src/catalog/catalog-types.ts` shared with `scripts/` so it stays dependency-free); E2E note: catalog faked via `context.route('**/catalog.json')`, `.env.e2e` no longer has `VITE_CATALOG_BASE_URL`; remove any remaining mirror/R2 mentions (including the opening "deployment" line).

- [ ] **Step 3: Verify** — `grep -rn "R2\|mirror\|VITE_CATALOG_BASE_URL" --include=*.md --include=*.ts --include=*.tsx --include=*.json . | grep -v node_modules | grep -v docs/superpowers` → no hits except intentional history.

- [ ] **Step 4: Commit** — `docs: document the link catalog and remove mirror instructions`
