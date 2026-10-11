# Import performance baseline

Measured on 2026-10-09 on an Apple M5 Max (arm64), 36 GiB RAM (38654705664 bytes), Node v24.21.0. Browser import not measured (no Chrome stopwatch run).

| Feed | Zip size | stop_times rows | Node load+index | Node derive | Node total | DB size | Browser (OPFS) total |
|------|----------|-----------------|-----------------|-------------|------------|---------|----------------------|
| MBTA (Fall 2026, 2026-10-09T17:16:18+00:00, version D) | 24.6 MB | 3,133,085 | 18.7 s | 3.0 s | 21.7 s | 351.7 MB | not measured |

Notes:
- Node numbers come from `npm run perf -- <feed.zip>`, which uses an in-memory sqlite-wasm database through the same loader/derive code as the browser. The import reported 0 issues and no fatal errors.
- Load and index dominated (18.7 s of 21.7 s); derive was 3.0 s.
- The browser (OPFS) import should be timed manually: run `npm run dev`, upload the same zip in Chrome, and time from the file chooser closing to the route list appearing. OPFS timings will differ from the in-memory Node run.

## Translated queries

Measured on 2026-10-09 in WSL2 (Linux 6.18, x86_64), Node v26.5.0, with `npm run perf -- <feed.zip>`. Each query ran once; the untranslated run goes first and absorbs cold-start cost, so treat these as indicative.

| Feed | Zip size | stop_times rows | Translations | Language | Busiest stop | Date | `getMapLabels` (original / translated) | `getStopDepartures` (original / translated) |
|------|----------|-----------------|--------------|----------|--------------|------|----------------------------------------|---------------------------------------------|
| Tokyo Metro (ODPT, feed_version 20261008) | 1.1 MB | 176,385 | 494 rows, all matched by `field_value` | en (original ja) | 209 | 20260919 | 3.0 ms / 1.3 ms | 10.6 ms / 9.8 ms |

Notes:
- The import itself took 1.8 s (1.7 s load+index, 0.1 s derive), 20.9 MB DB, 0 issues.
- The busiest stop is a platform-level stop, so the parent-station path is not timed, and the date is the feed's first service day, which may be lighter than a weekday.
- To re-measure, run `npm run perf -- <feed with translations.txt>`.

## Validation

Measured on 2026-10-10 in WSL2 (Linux 6.18, x86_64), AMD Ryzen 7 9800X3D (16 threads), 93 GiB RAM, Node v26.5.0, with `npm run perf -- <feed.zip>` (in-memory sqlite-wasm, same checks as the worker). Feed: MBTA (mdb-437 latest), 24.6 MB zip, 3,133,085 stop_times rows. This run's import was slower than the table above (load+index 39.9 s, derive 4.5 s), so absolute times here are pessimistic.

`maxStepMs` is the longest stretch between `ctx.checkpoint()` calls within a check (the budget is about 250 ms, so queued queries are never blocked longer than that).

| Check (first rule) | totalMs | maxStepMs |
|--------------------|---------|-----------|
| `trip_unknown_route` (references) | 164 | 57 |
| `stop_time_unknown_trip` (stop times) | 15,042 | 117 |
| `route_without_trips` (coverage) | 15 | 6 |
| `unrealistic_speed` (patterns) | 1,535 | 108 |
| `stop_invalid_coords` (stops) | 71 | 47 |
| `feed_expired` (feed) | 5 | 2 |
| **Total** | **16.8 s** | |

Peak process RSS after validation: 807 MB. This includes the 352 MB in-memory database and Node's own overhead, so it overstates the browser's cost; see "Browser memory" below for a direct measurement. (The patterns check then cached every shape polyline; it now keeps only the current route's.)

Notes:
- The stop_times scan dominates (about 90%). It is linear in row count (about 5 us per row through sqlite-wasm and JS row objects) and is above the original ~10 s target on this feed; the browser runs it in the background, in chunks.
- Before tuning (`TRIP_BATCH` 2000, 200 patterns per chunk) the worst step was 566 ms in the stop_times check and 359 ms in the patterns check. Now `TRIP_BATCH` is 500, patterns per chunk is 50, and the trips map is loaded in 20,000-row pages with a checkpoint between them (loading it in one go was a single 300 ms step).
- Issue counts on MBTA (total per rule):

| Rule | Severity | Total |
|------|----------|-------|
| `trip_too_few_stops` | error | 7 |
| `unrealistic_speed` | warning | 103 |
| `stop_far_from_shape` | warning | 9 |
| `route_without_trips` | warning | 30 |
| `stop_unused` | warning | 146 |
| `service_never_active` | warning | 210 |
| `stops_near_duplicate` | info | 347 |
| `route_color_contrast` | info | 1 |

- Samples look like real data quirks: one-stop "-sample" trips, `canonical-*` trips with placeholder times (900+ km/h), shuttle routes whose line passes 110-150 m from a station, duplicate-named stops 0 m apart (platforms), and a `canonical` service with no calendar dates.

### Browser memory

Measured on 2026-10-10, same machine, headless Chromium (Playwright's bundled build) against `vite --mode e2e` (fake map), uploading the same MBTA zip. A throwaway script sampled the RSS of the browser's process tree every 250 ms with `ps`; the renderer process hosts the page and its database worker. Phases are split at the URL gaining `?feed=` (import done) and Feed details showing its Issues result (validation done).

| Phase | Duration | Peak renderer RSS | Peak browser tree RSS |
|-------|----------|-------------------|-----------------------|
| App loaded, idle | — | 161 MB | 494 MB |
| Import (OPFS) | 359 s | 552 MB | 1,253 MB |
| Validation | 33 s | 642 MB | 1,338 MB |
| Idle afterwards | — | 621 MB | 1,317 MB |

Notes:
- Validation peaks about 90 MB above the import's peak. In the browser the database lives in OPFS, so only SQLite's page cache and the checks' working data are in memory; the Node figure above is not representative.
- Memory is not given back after validation (621 MB idle), consistent with the WebAssembly heap growing but never shrinking.
- The browser import took about 6 minutes, roughly 8x the Node import on the same machine. "Browser import" below found the cause and the fix.
- Result: "7 errors · 498 warnings · 348 info". Low-memory devices may struggle with MBTA-sized feeds; most of the peak is already reached during import, and validation adds about 90 MB on top.
- Validation took 33 s here, about twice the Node run, as expected with OPFS-backed reads and the UI's queries interleaving.
- This is a single run, and peaks were sampled every 250 ms, so short spikes may be missed.

## Browser import

Measured on 2026-10-10, same machine and setup as "Browser memory" (headless Chromium, `vite --mode e2e`, MBTA zip, one run per variant). Temporary timing logs in the worker split the import into stages; the variants changed SQLite settings for the import connection only.

| Import settings | Parse + insert | Indexes | Derive | Import total | Validation | Peak renderer RSS (import / validation) | Park Street departures after reload |
|---|---|---|---|---|---|---|---|
| 4 KB pages, 2 MB cache (before) | 51 s | 31 s | 261 s | 343 s | 32 s | 551 / 633 MB | 1.9 s |
| 256 MB cache | 51 s | 12 s | 19 s | 83 s | — | — | — |
| 64 KB pages | 35 s | 6 s | 103 s | 144 s | — | — | — |
| **64 KB pages, 64 MB cache (now)** | 36 s | 6 s | 17 s | **60 s** | 18 s | 517 / 675 MB | 0.9 s |
| 64 KB pages, 256 MB cache | 36 s | 3 s | 5 s | 45 s | 18 s | 722 / 874 MB | 0.9 s |
| 16 KB pages, 256 MB cache | — | — | — | 61 s | 24 s | 716 / 876 MB | 1.4 s |

Notes:
- The cost was OPFS reads, not writes: with a 2 MB cache, derive's walk over stop_times in trip order missed the cache on almost every page. Node runs in memory and never paid it.
- `configureForImport` (`src/worker/ddl.ts`) now sets 64 KB pages (kept by the file, so the explorer and validation benefit too) and a 64 MB cache for the import connection only. The 256 MB cache saves another 15 s but costs about 200 MB of peak memory; larger commit batches (200,000 rows) saved under 2 s and were dropped.
- The database is the same size with 64 KB pages (351.9 MB vs 352.9 MB in Node). Feeds imported earlier keep 4 KB pages until re-imported.
- Node, same machine, after the change: import 36.4 s (load+index 33.0 s, derive 3.4 s), validation 14.2 s, identical issue counts.
- Parsing and inserting rows is now most of the remaining time.
