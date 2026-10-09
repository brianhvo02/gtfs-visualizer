export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly sourceUrl: string;
}

export interface CatalogLockEntry {
  readonly sha256: string | null;
  readonly size: number | null;
  readonly fetchedAt: string | null;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
}

export interface CatalogLock {
  readonly generatedAt: string;
  readonly feeds: Readonly<Record<string, CatalogLockEntry>>;
}

export const CATALOG_FILE = 'catalog.json';
export const LOCK_FILE = 'catalog.lock.json';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function feedZipKey(id: string): string {
  return `feeds/${id}.zip`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(entry: Record<string, unknown>, key: string, index: number): string {
  const value = entry[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Catalog entry ${index} needs a non-empty string "${key}".`);
  }
  return value;
}

export function parseCatalog(json: unknown): CatalogEntry[] {
  if (!Array.isArray(json)) throw new Error('The catalog must be a JSON array.');
  const seen = new Set<string>();
  return json.map((item: unknown, index): CatalogEntry => {
    if (!isRecord(item)) throw new Error(`Catalog entry ${index} must be an object.`);
    const id = requireString(item, 'id', index);
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Catalog entry ${index} has an invalid id "${id}" (use lowercase letters, digits, and dashes).`);
    }
    if (seen.has(id)) throw new Error(`Duplicate catalog id "${id}".`);
    seen.add(id);
    return {
      id,
      name: requireString(item, 'name', index),
      region: requireString(item, 'region', index),
      sourceUrl: requireString(item, 'sourceUrl', index),
    };
  });
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Lenient: anything unreadable yields an empty lock, so the catalog still works without mirror data. */
export function parseLock(json: unknown): CatalogLock {
  if (!isRecord(json) || !isRecord(json['feeds'])) return {generatedAt: '', feeds: {}};
  const feeds: Record<string, CatalogLockEntry> = {};
  for (const [id, value] of Object.entries(json['feeds'])) {
    if (!isRecord(value)) continue;
    feeds[id] = {
      sha256: optionalString(value['sha256']),
      size: typeof value['size'] === 'number' ? value['size'] : null,
      fetchedAt: optionalString(value['fetchedAt']),
      lastError: optionalString(value['lastError']),
      lastErrorAt: optionalString(value['lastErrorAt']),
    };
  }
  return {generatedAt: optionalString(json['generatedAt']) ?? '', feeds};
}
