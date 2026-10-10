import {CATALOG_PATH, parseCatalogSnapshot, type CatalogSnapshot} from './catalog-types.ts';

export async function loadCatalog(
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url, {cache: 'no-cache'}),
): Promise<CatalogSnapshot> {
  const response = await fetchFn(CATALOG_PATH);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${CATALOG_PATH}`);
  return parseCatalogSnapshot(await response.json());
}
