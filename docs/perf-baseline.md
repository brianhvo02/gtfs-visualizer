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
