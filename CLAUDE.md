# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                          # Vite dev server (needs VITE_MAPBOX_TOKEN in .env)
VITE_MAP_PROVIDER=fake npm run dev   # run without Mapbox (text-only stand-in map)
npm test                             # Vitest, all unit/integration tests (Node, sqlite-wasm in memory)
npx vitest run src/worker/loader_test.ts       # one test file
npx vitest run -t "applies calendar exceptions" # one test by name
npm run e2e                          # Playwright (Chromium) against `vite --mode e2e` on :5174
npx playwright test -g "second tab"  # one E2E test
npx tsc -b                           # type-check (app + node/scripts/e2e projects)
npm run lint                         # oxlint
npm run build                        # tsc -b && vite build
npm run perf -- path/to/feed.zip     # time a real import in Node (see docs/perf-baseline.md)
npm run catalog:sync                 # build public/catalog.json (also part of build); --if-missing on dev
npm run catalog:sync -- --update-snapshot  # also refresh committed catalog/mdb-snapshot.json
```

First E2E run: `npx playwright install chromium` (on Linux also `sudo npx playwright install-deps chromium` for its system libraries). E2E uses `.env.e2e` (`VITE_MAP_PROVIDER=fake`); the catalog (`context.route('**/catalog.json')`) and blocked-URL requests are faked in `e2e/helpers.ts` (`mockCatalog`).

## Architecture

Fully client-side app (static hosting, no backend, no COOP/COEP headers). Design spec: `docs/superpowers/specs/2026-10-09-feed-import-and-explorer-design.md`; deployment (Cloudflare Pages) and catalog maintenance: `docs/deploy.md`.

**Worker owns all data.** `src/worker/worker.ts` runs `@sqlite.org/sqlite-wasm` with the `opfs-sahpool` VFS and exposes a `FeedService` (`src/worker/feed-service.ts`) via Comlink. The UI only sees `FeedApi = Remote<FeedService>` (`src/db-client/feed-api.ts`) — every method is async, and UI code never writes SQL. UI-side modules may import from `src/worker` with `import type` only (exception: `src/db-client/host.ts`, which references the worker entry URL); types and constants needed on both sides (import issues/progress, `STORAGE_HEADROOM`) live in `src/shared/`.

**Worker lifecycle** (`src/db-client/worker-host.ts`): one tab at a time holds a Web Lock (`gtfs-visualizer-db`); a second tab shows "open in another tab" and can steal it, and the losing tab terminates its worker to release OPFS handles. A worker crash triggers one restart; `HostState.ready.generation` increments on every restart and `app.tsx` keys `<Explorer>` by it so in-flight UI state resets.

**Storage layout.** `FeedStore` (`src/worker/feed-store.ts`) abstracts files: `SahPoolFeedStore` in the browser, `MemoryFeedStore` in tests/scripts. One SQLite DB per feed at `/feeds/<id>-<epochMillis>.db`, plus a registry `/meta.db`. sahpool has no rename, so an import writes a new versioned file, switches the `meta.db` row, then deletes the old file; unreferenced files are swept in `FeedService.init()`. Feed ids: catalog = catalog id (re-import replaces); URL = `url-<slug>` (same URL replaces); upload = `file-<slug>` with `-2`, `-3` suffixes (never replaces).

**Import pipeline** (all in the worker): fetch/File stream → `loader.ts` (checks zip signature, streams entries through `fflate`, matches files by basename ignoring folders and `__MACOSX`) → `gtfs/csv.ts` streaming parser → `table-writer.ts` (header-mapped typed inserts, batched ~10k rows per transaction) → indexes created after load → `derive.ts` builds `route_patterns`, `route_shapes` (GeoJSON per route/shape, synthesized from stop sequence when a trip has no shape), `stop_routes` (includes parent stations), `feed_summary`. Schema is table-driven from `src/gtfs/schema.ts`; GTFS times are stored as text plus `*_secs` integers. Problems go to `import_issues` via `IssueCollector` (capped per file+code); `fatal` issues abort and delete the DB. `importFeed` returns an `ImportResult` union rather than throwing across Comlink.

**Validation.** Checks in `src/worker/validation/rules/` each own rule ids declared in `src/shared/validation.ts`; `runValidation` (`runner.ts`) runs them in order, buffers results per rule (a throwing check records an `errorMessage` for its rules), and writes everything in one transaction stamped with `RULESET_VERSION` (bump it on any rule, threshold, or message change so stored results go stale). `FeedService.ensureValidation` runs or joins a run per feed and `closeCurrent()` cancels it; results are read with `getValidationSummary`/`getValidationIssues`. Checks must call `ctx.checkpoint()` at least every ~250 ms of work (the sqlite connection is shared with UI queries); `npm run perf` prints per-check `maxStepMs`. `VALID_FEED` in the test fixtures must validate clean.

**Queries** (`src/worker/queries.ts`): departures for a date = that day's active services (`gtfs/service.ts`) plus the previous day's trips with `departure_secs ≥ 86400` (shifted back a day); a parent station's departures come from its child platforms. "Today" uses the feed's `agency_timezone`. Name-returning queries take a trailing `lang` and wrap columns with `translated(...)` from `src/worker/translate.ts`, which binds `$lang` (named parameters only in those queries); `getFeedLanguages` reads only `feed_summary`, so it works on feeds imported before translations existed.

**UI.** The URL (`?feed=&route=&stop=&date=&lang=&view=`) is the source of truth for selection (`src/state/url-state.ts`); `view=issues` opens the validation report. `lang` is the requested language (reserved value `original`); `src/state/resolve-language.ts` resolves it against the feed's languages and the browser's, returning the feed's spelling, and only that resolved `query` is passed to the worker, which matches it exactly. `src/ui/use-async.ts` tags results with the deps that produced them and returns `loading` when deps change, so views never see a previous input's result — rely on this rather than adding guards. The map is behind a provider-neutral `MapAdapter` (`src/map/adapter.ts`); only `src/map/mapbox-adapter.ts` may import `mapbox-gl`. `fake-adapter.ts` renders features as `button[data-layer]` with JSON state in `[data-testid="fake-map"]` `data-state` — E2E tests depend on that and on the accessible names in the sidebar views. Mapbox uses the Standard style: our layers go in its `middle` (routes) and `top` (stops) slots with `*-emissive-strength: 1` so the light preset doesn't darken them. The map lighting choice (`auto` follows `prefers-color-scheme`) is a per-browser preference in `localStorage` (`src/map/light-setting.ts`), not URL state.

**Catalog.** A catalog of links, not mirrored zips. `scripts/catalog/sync.ts` (`npm run catalog:sync`, run by `build`) merges the Mobility Database CSV (`CATALOG_MDB_URL`; falls back to committed `catalog/mdb-snapshot.json` if the download fails) with author-curated `catalog/catalog.json` (`{mdbId, ...overrides}` references or full entries; curated entries are featured; a full entry whose id equals a Mobility Database id fails the build, and only `{mdbId, ...overrides}` references change an existing feed) into git-ignored `public/catalog.json`, which the app fetches same-origin. Mobility Database ids may have uppercase and underscores (`FEED_ID_PATTERN`); curated full-entry ids use the stricter lowercase `ID_PATTERN`. Each entry's `access` is `direct`, `key` (query param or header; the visitor's key is stored per provider in `localStorage` as `gtfs-visualizer:key:<provider>` by `src/catalog/key-store.ts`, passed in `ImportSource`, never logged or put in URLs), or `download` (open the provider page, then upload). Import records the response's `ETag`/`Last-Modified`; `src/catalog/update-check.ts` compares them with a `HEAD` request (no download; `unknown` when the provider sends neither, or a key is missing) to show "Update available". Search is in `src/catalog/search.ts`. `src/catalog/catalog-types.ts` is shared with `scripts/`, so it must stay dependency-free.

## Conventions

- Google TypeScript style (`.agents/skills/typescript`): semicolons, single quotes, named exports only (except tool config files), no `any`, no non-null `!`, explicit return types on exports, kebab-case file names.
- Unit tests are `*_test.ts` next to the code (Vitest only picks up `src/**/*_test.ts` and `scripts/**/*_test.ts`); Playwright specs are `e2e/*.spec.ts`.
- `erasableSyntaxOnly`: no enums, parameter properties, or namespaces.
- Relative imports include the `.ts`/`.tsx` extension, so Node (≥ 24, type stripping) can run shared code from `scripts/`.
- `src/test-fixtures/sample-feed.ts` must depend only on `fflate` (Playwright and Node scripts import it); SQLite-backed helpers live in `sample-db.ts` / `test-db.ts`.
- Dependencies in the core set are pinned to exact versions.
- oxlint suppressions use rule names like `react-hooks/exhaustive-deps`, `react/purity`, `react/set-state-in-effect`, always with a one-line justification.
