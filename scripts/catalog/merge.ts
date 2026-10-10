import type {CatalogEntry, CuratedEntry} from '../../src/catalog/catalog-types.ts';

export function mergeCatalog(mdb: readonly CatalogEntry[], curated: readonly CuratedEntry[]): CatalogEntry[] {
  const byId = new Map(mdb.map((entry) => [entry.id, entry]));
  const featuredIds = new Set<string>();
  const featured: CatalogEntry[] = [];
  curated.forEach((item, index) => {
    const where = `catalog.json entry ${index}`;
    let resolved: CatalogEntry;
    if ('mdbId' in item) {
      const base = byId.get(item.mdbId);
      if (base === undefined) throw new Error(`${where}: unknown mdbId "${item.mdbId}"`);
      resolved = {...base, ...item.overrides, featured: true};
    } else {
      if (byId.has(item.entry.id)) {
        throw new Error(`${where}: id "${item.entry.id}" is already a Mobility Database feed`);
      }
      resolved = {...item.entry, featured: true};
    }
    if (featuredIds.has(resolved.id)) throw new Error(`${where}: duplicate id "${resolved.id}"`);
    featuredIds.add(resolved.id);
    featured.push(resolved);
  });
  const rest = mdb
    .filter((entry) => !featuredIds.has(entry.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}));
  return [...featured, ...rest];
}
