/** Shared with Node scripts: keep this file free of imports. */

/** minLon, minLat, maxLon, maxLat. */
export type Bbox = readonly [number, number, number, number];

export type Access =
  | {readonly kind: 'direct'}
  | {
      readonly kind: 'key';
      readonly provider: string;
      readonly signupUrl: string;
      readonly queryParam: string | null;
      readonly header: string | null;
    }
  | {readonly kind: 'download'; readonly pageUrl: string | null};

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly place: string;
  readonly url: string;
  readonly originalUrl: string | null;
  readonly access: Access;
  readonly license: string | null;
  readonly bbox: Bbox | null;
  readonly featured: boolean;
  readonly viaMobilityDatabase: boolean;
}

export interface CatalogSnapshot {
  readonly generatedAt: string;
  readonly entries: readonly CatalogEntry[];
}

type OverrideFields = Partial<Omit<CatalogEntry, 'id' | 'featured' | 'viaMobilityDatabase'>>;
type Mutable<T> = {-readonly [K in keyof T]: T[K]};

export type CuratedEntry =
  | {readonly mdbId: string; readonly overrides: Readonly<OverrideFields>}
  | {readonly entry: CatalogEntry};

export const CATALOG_PATH = '/catalog.json';
/** Ids of every catalog entry: they become OPFS file names and ?feed= values. */
export const FEED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where} must be an object.`);
  return value;
}

function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, key: string, where: string): string | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${where}: "${key}" must be a string`);
  return value;
}

function parseBbox(value: unknown, where: string): Bbox | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(`${where}: "bbox" must be [minLon, minLat, maxLon, maxLat]`);
  }
  return [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])];
}

export function parseAccess(json: unknown, where: string): Access {
  const access = requireRecord(json, `${where}: "access"`);
  switch (access['kind']) {
    case 'direct':
      return {kind: 'direct'};
    case 'download':
      return {kind: 'download', pageUrl: optionalString(access, 'pageUrl', `${where}: "access"`)};
    case 'key': {
      const at = `${where}: "access"`;
      const queryParam = optionalString(access, 'queryParam', at);
      const header = optionalString(access, 'header', at);
      if ((queryParam === null) === (header === null)) {
        throw new Error(`${where}: "access" needs exactly one of "queryParam" or "header"`);
      }
      return {
        kind: 'key',
        provider: requireString(access, 'provider', at),
        signupUrl: requireString(access, 'signupUrl', at),
        queryParam,
        header,
      };
    }
    default:
      throw new Error(`${where}: "access.kind" must be direct, key, or download`);
  }
}

function parseFullEntry(
  item: Record<string, unknown>,
  where: string,
  featured: boolean,
  checkId: boolean,
): CatalogEntry {
  const id = requireString(item, 'id', where);
  if (checkId && !ID_PATTERN.test(id)) {
    throw new Error(`${where}: "id" "${id}" is invalid (use lowercase letters, digits, and dashes)`);
  }
  if (!FEED_ID_PATTERN.test(id)) throw new Error(`${where}: "id" "${id}" is invalid (use letters, digits, dashes, and underscores)`);
  return {
    id,
    name: requireString(item, 'name', where),
    place: requireString(item, 'place', where),
    url: requireString(item, 'url', where),
    originalUrl: optionalString(item, 'originalUrl', where),
    access: parseAccess(item['access'], where),
    license: optionalString(item, 'license', where),
    bbox: parseBbox(item['bbox'], where),
    featured,
    viaMobilityDatabase: false,
  };
}

export function parseCuratedCatalog(json: unknown): CuratedEntry[] {
  if (!Array.isArray(json)) throw new Error('catalog.json must be a JSON array.');
  const seen = new Set<string>();
  return json.map((raw: unknown, index): CuratedEntry => {
    const where = `catalog.json entry ${index}`;
    const item = requireRecord(raw, where);
    if (item['mdbId'] !== undefined) {
      const mdbId = requireString(item, 'mdbId', where);
      const overrides: Mutable<OverrideFields> = {};
      if (item['name'] !== undefined) overrides.name = requireString(item, 'name', where);
      if (item['place'] !== undefined) overrides.place = requireString(item, 'place', where);
      if (item['url'] !== undefined) overrides.url = requireString(item, 'url', where);
      if (item['originalUrl'] !== undefined) overrides.originalUrl = optionalString(item, 'originalUrl', where);
      if (item['access'] !== undefined) overrides.access = parseAccess(item['access'], where);
      if (item['license'] !== undefined) overrides.license = optionalString(item, 'license', where);
      if (item['bbox'] !== undefined) overrides.bbox = parseBbox(item['bbox'], where);
      return {mdbId, overrides};
    }
    const entry = parseFullEntry(item, where, true, true);
    if (seen.has(entry.id)) throw new Error(`${where}: duplicate id "${entry.id}"`);
    seen.add(entry.id);
    return {entry};
  });
}

export function parseCatalogSnapshot(json: unknown): CatalogSnapshot {
  const root = requireRecord(json, 'catalog.json');
  const generatedAt = requireString(root, 'generatedAt', 'catalog.json');
  const rawEntries = root['entries'];
  if (!Array.isArray(rawEntries)) throw new Error('catalog.json: "entries" must be an array');
  const seen = new Set<string>();
  const entries = rawEntries.map((raw: unknown, index): CatalogEntry => {
    const where = `catalog.json entry ${index}`;
    const item = requireRecord(raw, where);
    const entry = parseFullEntry(item, where, item['featured'] === true, false);
    if (seen.has(entry.id)) throw new Error(`${where}: duplicate id "${entry.id}"`);
    seen.add(entry.id);
    return {...entry, viaMobilityDatabase: item['viaMobilityDatabase'] === true};
  });
  return {generatedAt, entries};
}
