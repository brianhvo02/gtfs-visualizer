# Deploying GTFS Visualizer

The app is static files on Cloudflare Pages. The feed catalog is a list of links built into the site at build time; the app never hosts or mirrors feed zips.

## 1. Mapbox token

Create a public token in your Mapbox account with **URL restrictions** set to the production domain (and `http://localhost:5173` for development if you like). Public tokens are visible to anyone using the site; the URL restriction is what limits abuse.

## 2. Cloudflare Pages

- Build command: `npm run build` (this runs `npm run catalog:sync` first, so the build needs network access)
- Output directory: `dist`
- Environment variables: `VITE_MAPBOX_TOKEN`, and `NODE_VERSION=24` (the build runs `scripts/catalog/sync.ts` directly, which needs Node 24's TypeScript type stripping; `.node-version` also pins it)
- No special headers are needed (the app does not use COOP/COEP).

## Maintaining the catalog

`npm run catalog:sync` writes `public/catalog.json` (git-ignored) from two sources and runs as part of `npm run build`. `npm run dev` runs it only when the file is missing.

1. The Mobility Database feed list (`CATALOG_MDB_URL`, default `https://files.mobilitydatabase.org/feeds_v2.csv`). If the download fails, the sync falls back to the committed `catalog/mdb-snapshot.json` and logs that it did; the build only fails if the snapshot is also missing or unusable.
2. Your curated entries in `catalog/catalog.json`, which are listed first as featured and must not reuse a Mobility Database id (the build fails on a collision; to change an existing feed, use a `{"mdbId": ...}` reference with overrides).

Curated entries come in two forms:

- Reference with overrides: `{"mdbId": "mdb-516"}` plus any of `name`, `place`, `url`, `originalUrl`, `access`, `license`, `bbox` to override what Mobility Database says.
- Full entry: `id`, `name`, `place`, `url`, `access`, and optionally `originalUrl`, `license`, `bbox`. Curated `id`s are lowercase letters, digits, and dashes. (Ids that come from Mobility Database may also contain uppercase letters and underscores.)

`access` says how a visitor gets the zip:

- `{"kind": "direct"}`: the browser fetches `url`.
- `{"kind": "key", "provider": "...", "signupUrl": "...", "queryParam": "..."}`: the provider needs a key. Give exactly one of `queryParam` (key sent as that query parameter) or `header` (key sent in that request header). Keys are the visitor's own, stored in their browser's `localStorage` per provider and used only for that provider's requests.
- `{"kind": "download", "pageUrl": "..."}`: no direct link; the visitor downloads the zip from `pageUrl` and uploads it.

To refresh the committed snapshot, run `npm run catalog:sync -- --update-snapshot` (needs network; the snapshot is only written after a successful download) and commit `catalog/mdb-snapshot.json`.

Mobility Database metadata is CC0. Each feed keeps its own license, which the app shows when the entry has one.
