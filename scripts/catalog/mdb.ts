import {FEED_ID_PATTERN} from '../../src/catalog/catalog-types.ts';
import type {Access, Bbox, CatalogEntry} from '../../src/catalog/catalog-types.ts';
import {parseCsv} from './csv.ts';

export const MDB_REQUIRED_COLUMNS: readonly string[] = [
  'id',
  'data_type',
  'status',
  'provider',
  'name',
  'location.country_code',
  'location.subdivision_name',
  'location.municipality',
  'urls.direct_download',
  'urls.authentication_type',
  'urls.authentication_info',
  'urls.api_key_parameter_name',
  'urls.latest',
  'urls.license',
  'is_official',
  'location.bounding_box.minimum_latitude',
  'location.bounding_box.maximum_latitude',
  'location.bounding_box.minimum_longitude',
  'location.bounding_box.maximum_longitude',
];

export function rowsFromCsv(text: string): Record<string, string>[] {
  const [header = [], ...body] = parseCsv(text);
  for (const column of MDB_REQUIRED_COLUMNS) {
    if (!header.includes(column)) throw new Error(`feeds_v2.csv is missing column ${column}`);
  }
  return body.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      record[name] = cells[i] ?? '';
    });
    return record;
  });
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hostOf(url: string | null): string {
  if (url === null) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Hosts that serve the same URLs over https; Mobility Database lists some of them as http, which an https site can't fetch. */
const HTTPS_HOSTS: ReadonlySet<string> = new Set(['api.511.org']);

function preferHttps(url: string | null): string | null {
  if (url === null || !url.startsWith('http://')) return url;
  return HTTPS_HOSTS.has(hostOf(url)) ? `https://${url.slice('http://'.length)}` : url;
}

function bboxOf(row: Record<string, string>): Bbox | null {
  const get = (key: string): number | null => {
    const value = nonEmpty(row[`location.bounding_box.${key}`]);
    if (value === null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const minLat = get('minimum_latitude');
  const maxLat = get('maximum_latitude');
  const minLon = get('minimum_longitude');
  const maxLon = get('maximum_longitude');
  if (minLat === null || maxLat === null || minLon === null || maxLon === null) return null;
  return [minLon, minLat, maxLon, maxLat];
}

function mapRow(row: Record<string, string>): CatalogEntry | null {
  const id = nonEmpty(row['id']);
  if (id === null) return null;
  const provider = nonEmpty(row['provider']);
  const rawName = nonEmpty(row['name']);
  const name = rawName === null ? (provider ?? id) : provider !== null && provider !== rawName ? `${provider} — ${rawName}` : rawName;
  const place = ['location.municipality', 'location.subdivision_name', 'location.country_code']
    .map((key) => nonEmpty(row[key]))
    .filter((part): part is string => part !== null)
    .join(', ');
  const direct = preferHttps(nonEmpty(row['urls.direct_download']));
  const latest = nonEmpty(row['urls.latest']);
  const authType = nonEmpty(row['urls.authentication_type']);
  const signupUrl = nonEmpty(row['urls.authentication_info']);
  const param = nonEmpty(row['urls.api_key_parameter_name']);

  let access: Access = {kind: 'download', pageUrl: null};
  let url = direct;
  let via = false;
  if ((authType === '1' || authType === '2') && signupUrl !== null && param !== null && direct !== null) {
    access = {
      kind: 'key',
      provider: hostOf(direct) || id,
      signupUrl,
      queryParam: authType === '1' ? param : null,
      header: authType === '2' ? param : null,
    };
  } else if (authType !== '1' && authType !== '2' && latest !== null) {
    access = {kind: 'direct'};
    url = latest;
    via = true;
  }
  if (url === null) return null;
  return {
    id,
    name,
    place,
    url,
    originalUrl: direct,
    access,
    license: nonEmpty(row['urls.license']),
    bbox: bboxOf(row),
    featured: false,
    viaMobilityDatabase: via,
    official: /^true$/i.test(row['is_official'] ?? ''),
  };
}

export interface MappedRows {
  readonly entries: CatalogEntry[];
  readonly skipped: {readonly invalidId: number; readonly duplicateId: number};
}

export function mapMobilityDatabaseRows(rows: readonly Record<string, string>[]): MappedRows {
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  let invalidId = 0;
  let duplicateId = 0;
  for (const row of rows) {
    if (row['data_type'] !== 'gtfs') continue;
    const status = row['status'] ?? '';
    if (status !== 'active' && status !== '') continue;
    const entry = mapRow(row);
    if (entry === null) continue;
    if (!FEED_ID_PATTERN.test(entry.id)) {
      invalidId++;
    } else if (seen.has(entry.id)) {
      duplicateId++;
    } else {
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return {entries, skipped: {invalidId, duplicateId}};
}
