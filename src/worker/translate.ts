export type TranslatableTable = 'agency' | 'stops' | 'routes' | 'trips' | 'feed_info';

const RECORD_KEYS: Readonly<Record<TranslatableTable, string | null>> = {
  agency: 'agency_id',
  stops: 'stop_id',
  routes: 'route_id',
  trips: 'trip_id',
  feed_info: null,
};

/**
 * SQL expression yielding a feed text field translated into `$lang`, falling back to the original value.
 * Table and field are code constants; the language is always the bound `$lang`. With a null language this
 * is the bare column and the statement contains no `$lang` (pair with `langParams`).
 */
export function translated(table: TranslatableTable, field: string, alias: string, lang: string | null): string {
  const column = `${alias}.${field}`;
  if (lang === null) return column;
  const base =
    `SELECT tr.translation FROM translations tr WHERE tr.table_name = '${table}' ` +
    `AND tr.field_name = '${field}' AND tr.language = $lang AND tr.translation IS NOT NULL`;
  const key = RECORD_KEYS[table];
  if (key === null) return `COALESCE((${base} ORDER BY tr.rowid LIMIT 1), ${column})`;
  return (
    `COALESCE((${base} AND tr.record_id = ${alias}.${key} ORDER BY tr.rowid LIMIT 1), ` +
    `(${base} AND tr.field_value = ${column} ORDER BY tr.rowid LIMIT 1), ${column})`
  );
}

/** Named bind parameters matching `translated(..., lang)`. */
export function langParams(lang: string | null): Record<string, string> {
  return lang === null ? {} : {$lang: lang};
}
