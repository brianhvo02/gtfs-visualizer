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

Not measured yet: no real feed with `translations.txt` was at hand. To measure, run `npm run perf -- <feed with translations.txt>`; it prints a second table with milliseconds for `getMapLabels` and `getStopDepartures` (busiest stop, first day of service) with no language and with the feed's first non-original language.
