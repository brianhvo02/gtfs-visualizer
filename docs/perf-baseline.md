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

Peak process RSS after validation: 807 MB (this includes the 352 MB in-memory database, which the browser keeps in OPFS instead, so the validation share is roughly 450 MB; the patterns check caches every shape polyline).

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
