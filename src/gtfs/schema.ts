import {checkTranslationRow} from './translations.ts';

export type ColumnType = 'text' | 'int' | 'real' | 'time';

export interface ColumnDef {
  readonly name: string;
  readonly type: ColumnType;
  readonly required?: boolean;
}

export interface TableDef {
  readonly table: string;
  readonly file: string;
  readonly requiredFile: boolean;
  readonly columns: readonly ColumnDef[];
  readonly indexes: readonly (readonly string[])[];
  /** Returns an error message to skip the row, or null to keep it. */
  readonly checkRow?: (get: (column: string) => string) => string | null;
}

const text = (name: string, required = false): ColumnDef => ({name, type: 'text', required});
const int = (name: string, required = false): ColumnDef => ({name, type: 'int', required});
const real = (name: string, required = false): ColumnDef => ({name, type: 'real', required});
const time = (name: string, required = false): ColumnDef => ({name, type: 'time', required});

const WEEKDAY_COLUMNS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
].map((day) => int(day, true));

export const GTFS_TABLES: readonly TableDef[] = [
  {
    table: 'agency',
    file: 'agency.txt',
    requiredFile: true,
    columns: [
      text('agency_id'),
      text('agency_name', true),
      text('agency_url', true),
      text('agency_timezone', true),
      text('agency_lang'),
      text('agency_phone'),
      text('agency_fare_url'),
      text('agency_email'),
    ],
    indexes: [],
  },
  {
    table: 'stops',
    file: 'stops.txt',
    requiredFile: true,
    columns: [
      text('stop_id', true),
      text('stop_code'),
      text('stop_name'),
      text('tts_stop_name'),
      text('stop_desc'),
      real('stop_lat'),
      real('stop_lon'),
      text('zone_id'),
      text('stop_url'),
      int('location_type'),
      text('parent_station'),
      text('stop_timezone'),
      int('wheelchair_boarding'),
      text('level_id'),
      text('platform_code'),
    ],
    indexes: [['stop_id'], ['parent_station']],
  },
  {
    table: 'routes',
    file: 'routes.txt',
    requiredFile: true,
    columns: [
      text('route_id', true),
      text('agency_id'),
      text('route_short_name'),
      text('route_long_name'),
      text('route_desc'),
      int('route_type', true),
      text('route_url'),
      text('route_color'),
      text('route_text_color'),
      int('route_sort_order'),
      int('continuous_pickup'),
      int('continuous_drop_off'),
      text('network_id'),
    ],
    indexes: [['route_id']],
  },
  {
    table: 'trips',
    file: 'trips.txt',
    requiredFile: true,
    columns: [
      text('route_id', true),
      text('service_id', true),
      text('trip_id', true),
      text('trip_headsign'),
      text('trip_short_name'),
      int('direction_id'),
      text('block_id'),
      text('shape_id'),
      int('wheelchair_accessible'),
      int('bikes_allowed'),
    ],
    indexes: [['trip_id'], ['route_id'], ['shape_id'], ['service_id']],
  },
  {
    table: 'stop_times',
    file: 'stop_times.txt',
    requiredFile: true,
    columns: [
      text('trip_id', true),
      time('arrival_time'),
      time('departure_time'),
      text('stop_id', true),
      int('stop_sequence', true),
      text('stop_headsign'),
      int('pickup_type'),
      int('drop_off_type'),
      int('continuous_pickup'),
      int('continuous_drop_off'),
      real('shape_dist_traveled'),
      int('timepoint'),
    ],
    indexes: [['trip_id', 'stop_sequence'], ['stop_id']],
  },
  {
    table: 'calendar',
    file: 'calendar.txt',
    requiredFile: false,
    columns: [
      text('service_id', true),
      ...WEEKDAY_COLUMNS,
      text('start_date', true),
      text('end_date', true),
    ],
    indexes: [['service_id']],
  },
  {
    table: 'calendar_dates',
    file: 'calendar_dates.txt',
    requiredFile: false,
    columns: [text('service_id', true), text('date', true), int('exception_type', true)],
    indexes: [['service_id'], ['date']],
  },
  {
    table: 'shapes',
    file: 'shapes.txt',
    requiredFile: false,
    columns: [
      text('shape_id', true),
      real('shape_pt_lat', true),
      real('shape_pt_lon', true),
      int('shape_pt_sequence', true),
      real('shape_dist_traveled'),
    ],
    indexes: [['shape_id', 'shape_pt_sequence']],
  },
  {
    table: 'frequencies',
    file: 'frequencies.txt',
    requiredFile: false,
    columns: [
      text('trip_id', true),
      time('start_time', true),
      time('end_time', true),
      int('headway_secs', true),
      int('exact_times'),
    ],
    indexes: [['trip_id']],
  },
  {
    table: 'feed_info',
    file: 'feed_info.txt',
    requiredFile: false,
    columns: [
      text('feed_publisher_name', true),
      text('feed_publisher_url', true),
      text('feed_lang', true),
      text('default_lang'),
      text('feed_start_date'),
      text('feed_end_date'),
      text('feed_version'),
      text('feed_contact_email'),
      text('feed_contact_url'),
    ],
    indexes: [],
  },
  {
    table: 'translations',
    file: 'translations.txt',
    requiredFile: false,
    columns: [
      text('table_name', true),
      text('field_name', true),
      text('language', true),
      text('translation', true),
      text('record_id'),
      text('record_sub_id'),
      text('field_value'),
    ],
    indexes: [
      ['table_name', 'field_name', 'language', 'record_id', 'record_sub_id'],
      ['table_name', 'field_name', 'language', 'field_value'],
    ],
    checkRow: checkTranslationRow,
  },
];

const BY_FILE = new Map(GTFS_TABLES.map((def) => [def.file, def]));

export function tableForFile(fileName: string): TableDef | undefined {
  return BY_FILE.get(fileName);
}

/** Name of the integer-seconds companion column for a GTFS time column. */
export function secsColumn(timeColumn: string): string {
  return timeColumn.replace(/_time$/, '_secs');
}
