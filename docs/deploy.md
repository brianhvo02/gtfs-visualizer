# Deploying GTFS Visualizer

The app is static files on Cloudflare Pages. Catalog feeds are mirrored nightly into a Cloudflare R2 bucket by a GitHub Action.

## 1. R2 bucket

1. Create a bucket (e.g. `gtfs-visualizer-feeds`).
2. Make it publicly readable through a custom domain (e.g. `feeds.example.com`) or the bucket's `r2.dev` URL. This URL is `VITE_CATALOG_BASE_URL`.
3. Add this CORS policy (Bucket → Settings → CORS), replacing the Pages domain:

```json
[
  {
    "AllowedOrigins": ["https://gtfs-visualizer.pages.dev", "http://localhost:5173"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Create an R2 API token with Object Read & Write on this bucket.

## 2. GitHub secrets

Add repository secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Run the "Mirror catalog feeds" workflow once by hand (Actions → Run workflow) to populate the bucket.

## 3. Mapbox token

Create a public token in your Mapbox account with **URL restrictions** set to the production domain (and `http://localhost:5173` for development if you like). Public tokens are visible to anyone using the site; the URL restriction is what limits abuse.

## 4. Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_MAPBOX_TOKEN`, `VITE_CATALOG_BASE_URL`
- No special headers are needed (the app does not use COOP/COEP).

## Maintaining the catalog

Edit `catalog/catalog.json`. Each entry needs a unique `id` (lowercase letters, digits, dashes), a `name`, a `region`, and the agency's `sourceUrl`. Commit and run the workflow (or wait for the nightly run). A feed that fails to download keeps its last good copy; the failure is recorded in `catalog.lock.json` and the workflow run is marked failed. Downloads time out after 2 minutes. GitHub disables scheduled workflows after 60 days without repository activity, so re-enable the workflow or push a commit periodically.
