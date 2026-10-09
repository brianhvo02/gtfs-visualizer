# GTFS Visualizer

Explore public-transit GTFS feeds in the browser. Feeds are imported into SQLite databases stored in your browser (OPFS) — nothing is uploaded anywhere.

## Development

```bash
npm install
cp .env.example .env   # add a Mapbox token
npm run dev
```

Without a Mapbox token, run `VITE_MAP_PROVIDER=fake npm run dev` to use a text-only stand-in map.

## Tests

- `npm test` — unit and integration tests (Vitest, sqlite-wasm in Node)
- `npm run e2e` — end-to-end tests (Playwright, Chromium)
- `npm run perf -- path/to/feed.zip` — import timing for a real feed

## Deployment

See [docs/deploy.md](docs/deploy.md). Design: [docs/superpowers/specs/2026-10-09-feed-import-and-explorer-design.md](docs/superpowers/specs/2026-10-09-feed-import-and-explorer-design.md).
