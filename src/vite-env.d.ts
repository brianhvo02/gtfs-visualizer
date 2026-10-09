/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_CATALOG_BASE_URL?: string;
  readonly VITE_MAP_PROVIDER?: 'mapbox' | 'fake';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
