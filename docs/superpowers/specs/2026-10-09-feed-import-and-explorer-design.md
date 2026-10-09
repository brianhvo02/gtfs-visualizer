# GTFS Visualizer — Feed Import, Data Layer & Static Explorer

**Date:** 2026-10-09
**Status:** Approved design, pending implementation plan
**Scope:** Sub-projects 1 (feed import + SQLite data layer) and 2 (static network explorer) of the GTFS Visualizer roadmap.

## 1. Purpose & audience

A browser-based GTFS visualizer for the author, other developers, and the public. It converts GTFS feeds into SQLite databases stored in the user's Origin Private File System (OPFS) and lets users explore a feed's static network on a map.

### Roadmap (each item gets its own spec → plan → implementation cycle)

1. **Feed import & data layer** — *this spec*
2. **Static network explorer** — *this spec*
3. **Validation** — full rule-based checks and an error report, building on the `import_issues` table defined here.
4. **Scheduled animation** — vehicles moving along routes by schedule; reuses `activeServiceIds` and `route_shapes`.
5. **Realtime** — GTFS-Realtime vehicle positions as an alternate position source; will require a proxy.
6. *(Later consideration)* Multi-feed overlay.

### Design constraints carried forward

- Fully client-side; deployable to static hosting with no special headers (no COOP/COEP).
- The map layer is isolated behind an adapter so the map provider can change.
- Vehicle positions (sub-projects 4/5) will be modeled as a swappable source; nothing in this spec should assume positions only come from the schedule.

## 2. Decisions

| Topic | Decision | Rationale |
|---|---|---|
| Feed sources | Curated catalog (maintained by the author) + paste URL + file upload | Public-friendly discovery; upload always works |
| Catalog delivery | Nightly mirror of catalog feeds to Cloudflare R2 via GitHub Action | Avoids CORS without a live proxy; static schedules change slowly |
| Hosting | Cloudflare Pages (app) + R2 (mirrored zips) | No file size limits, free egress |
| Map library | Mapbox GL JS behind a `MapAdapter` | Author preference; adapter keeps a MapLibre swap cheap |
| SQLite | `@sqlite.org/sqlite-wasm` with `opfs-sahpool` VFS in a dedicated worker | Official package; works without COOP/COEP |
| Feeds per DB | One `.db` file per feed; one active feed at a time | Simple lifecycle; multi-feed overlay deferred |

## 3. Architecture

```
┌────────────── Main thread (React) ──────────────┐
│ ui/        Sidebar, RouteDetail, StopDetail,     │
│            FeedPicker, ImportDialog, FeedInfo    │
│ map/       MapView + MapAdapter (Mapbox wrapper) │
│ state/     URL-synced selection (feed/route/stop)│
│ db-client/ typed RPC proxy → worker              │
└───────────────────┬─────────────────────────────┘
                    │ postMessage (typed requests / progress events)
┌───────────────────▼──────── DB Worker ──────────┐
│ rpc/       request router                       │
│ storage/   sqlite-wasm + opfs-sahpool, one .db   │
│            per feed, feeds registry (meta.db)    │
│ import/    fetch|file → fflate unzip → CSV       │
│            stream → batched inserts → derive     │
│ queries/   routes, stops, shapes, departures     │
└─────────────────────────────────────────────────┘
Cloudflare Pages: app
Cloudflare R2:    catalog.json, catalog.lock.json, feeds/<id>.zip
```

### Units

- **`MapAdapter`** — the only module importing `mapbox-gl`. Interface: `setSource(id, geojson)`, `addLayer(spec)`, `removeLayer(id)`, `setFilter(layerId, filter)`, `fitBounds(bbox)`, `onFeatureClick(layerIds, handler)`, `onFeatureHover(layerIds, handler)`. Layer specs passed in are provider-neutral objects the adapter translates.
- **`db-client`** — typed async API proxying to the worker. UI never sees SQL. Initial surface:
  - `listFeeds()`, `deleteFeed(id)`
  - `importFeed(source, onProgress)` where `source` is `{kind:'catalog', id}` | `{kind:'url', url}` | `{kind:'file', file}`
  - `openFeed(id)`
  - `getFeedSummary(feedId)`, `getRoutes(feedId)`, `getRouteShapesGeoJSON(feedId)`, `getStopsGeoJSON(feedId)`
  - `getRouteDetail(feedId, routeId)` (patterns + ordered stops)
  - `getStopDetail(feedId, stopId)` (serving routes)
  - `getStopDepartures(feedId, stopId, serviceDate)`
- **`state/`** — selection state (`feed`, `route`, `stop`, `date`) read from and written to URL query params; the URL is the source of truth.
- **`meta.db`** — feed registry: `id, name, source_kind, source_ref, catalog_sha256, imported_at, service_start, service_end, db_filename`.
- **Catalog** — `catalog.json`, author-maintained: `[{id, name, region, sourceUrl}]`. The app reads it plus `catalog.lock.json` and shows "update available" when the mirrored `sha256` differs from the imported `catalog_sha256`.

## 4. Import pipeline

Runs entirely in the worker; emits progress events `{stage, file?, rowsDone?, bytesDone?, bytesTotal?}`.

1. **Acquire** — R2 (catalog), user URL, or `File`. URL fetches stream for progress. A CORS/network failure yields a typed error the UI renders as "download it and upload the zip instead".
2. **Unzip** — `fflate` streaming per entry.
3. **Parse** — streaming CSV parser: RFC 4180 quoting, UTF-8 BOM stripping, `\r\n`/`\n`, header-mapped columns, unknown columns ignored, missing optional columns → `NULL`.
4. **Insert** — prepared statements, transactions of ~10k rows. Indexes created after bulk load.
5. **Derive** — build derived tables (below).
6. **Register** — write the DB as `<id>.tmp.db`; on success rename to `<id>.db` and upsert into `meta.db`. On any fatal error delete the temp DB; an existing `<id>.db` is untouched until the rename.

### Schema

One table per GTFS file using spec field names: `agency`, `stops`, `routes`, `trips`, `stop_times`, `calendar`, `calendar_dates`, `shapes`, `frequencies`, `feed_info`. Any other file in the zip is stored as rows in `extra_files(file_name, line, json)`.

GTFS times (`HH:MM:SS`, may exceed 24h) are stored as integer seconds past midnight (`arrival_secs`, `departure_secs`) alongside the original text.

### Derived tables

- `route_shapes(route_id, shape_id, geojson)` — encoded LineString per route/shape. For trips with no `shape_id`, geometry is synthesized from the stop sequence.
- `route_patterns(route_id, direction_id, pattern_id, stop_ids_json, trip_count)` — distinct ordered stop sequences.
- `stop_routes(stop_id, route_id)`.
- `feed_summary` — row counts per table, service date range.

### Import issues

`import_issues(severity, file, line, column, code, message)` records structural problems: missing required file/column, malformed row, unparseable value. Non-fatal issues are recorded and import continues. Fatal (abort import): not a zip; missing a required file (`agency.txt`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, and at least one of `calendar.txt`/`calendar_dates.txt`); missing a required column in a required file. The Validation sub-project will extend this table with rule-based checks.

## 5. Explorer

### Map layers (via `MapAdapter`)

- `routes-line` — from `route_shapes`, colored by `route_color`, falling back to a per-`route_type` palette.
- `routes-highlight` — selected route drawn thicker; others dimmed.
- `stops-circle` — visible at zoom ≥ 13; stops on the selected route are always visible.
- `stop-highlight` — selected stop.
- Click selects the nearest feature; hover shows a name tooltip.

### Sidebar views (URL-driven)

- No `feed` → **Feed picker**: catalog feeds and saved feeds; import, re-import, delete, "update available".
- `?feed=X` → **Route list** (search; route-type filter chips) and **Feed info** panel (agency, `feed_info` dates, record counts).
- `&route=R` → **Route detail**: pattern switcher from `route_patterns`; ordered stop list; clicking a stop selects it. Map fits to the route.
- `&stop=S` → **Stop detail**: serving routes; departures for `&date=` (default: today in the agency timezone), with a date picker.

### Service-day resolution

`activeServiceIds(serviceDate)` = services from `calendar` whose weekday flag is set and whose `start_date ≤ date ≤ end_date`, plus `calendar_dates` with `exception_type = 1`, minus those with `exception_type = 2`.

Departures for a stop on date D = `stop_times` at the stop for trips whose `service_id ∈ activeServiceIds(D)`, plus trips with `service_id ∈ activeServiceIds(D − 1)` whose `departure_secs ≥ 86400` (shown at `departure_secs − 86400`). Results ordered by departure time.

"Today" is computed in `agency_timezone` (first agency row), not the browser timezone.

### Out of scope for v1

Full timetable grids, trip planning, headway/coverage analytics, `frequencies.txt`-based departure expansion (stored but not expanded), multi-feed overlay, validation report UI, animation, realtime.

## 6. Error handling

| Condition | Behavior |
|---|---|
| CORS / network failure on URL | Explain; offer upload |
| Not a zip / fatal import issue | Abort, delete temp DB, show reason |
| Low storage | Pre-check `navigator.storage.estimate()`; warn if free < ~15× zip size (measured ~14× on MBTA). On quota error mid-import, roll back and suggest deleting feeds |
| Eviction risk | Call `navigator.storage.persist()` after first successful import |
| Second tab | Web Lock held while DB open; second tab shows "open in another tab — close it or take over" |
| Unsupported browser (no OPFS / worker) | Full-page notice listing supported browsers |
| Worker crash | Client detects, restarts worker, re-opens feed once; then error panel |
| Missing/invalid Mapbox token | Sidebar remains usable; map area shows a notice |

Mapbox access token: public token, URL-restricted to the production domain, provided via a Vite env variable.

## 7. Catalog mirror job

GitHub Action on a nightly schedule (plus manual dispatch):

1. Read `catalog.json` from the repo.
2. For each entry, download `sourceUrl`, verify it is a zip containing `stops.txt`.
3. Upload to R2 at `feeds/<id>.zip`; compute `sha256`, size, and fetch time.
4. Write and upload `catalog.json` and `catalog.lock.json`.
5. A failing feed keeps its previous mirrored copy, is marked `lastError` in the lock file, and does not fail the other feeds. The job exits non-zero if any feed failed, so failures are visible.

R2 bucket CORS policy allows `GET` from the app origin.

## 8. Testing

- **Unit (Vitest):** CSV parser (quoting, BOM, line endings, ragged rows); GTFS time → seconds; `activeServiceIds` (exceptions, after-midnight trips, timezone edges); shape and stop-sequence geometry building.
- **Import integration:** sqlite-wasm in Node against fixtures — the canonical GTFS sample feed and hand-made broken feeds (missing required file, bad references, shape-less route). Assert row counts, derived tables, and `import_issues`.
- **E2E (Playwright):** import a fixture; select a route and confirm highlight and URL; open a stop and check departures; reload a deep link and confirm restored state; simulated CORS failure shows fallback. Mapbox is stubbed through `MapAdapter`.
- **Performance smoke:** import a large real feed (e.g. a regional feed on the scale of 511 SF Bay); record import time and DB size as a baseline.
