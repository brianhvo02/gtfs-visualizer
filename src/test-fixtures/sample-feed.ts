import {strToU8, zipSync} from 'fflate';

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

export const SAMPLE_FEED: Readonly<Record<string, string>> = {
  'agency.txt': lines(
    'agency_id,agency_name,agency_url,agency_timezone',
    'DTA,Demo Transit Authority,https://example.com,America/Los_Angeles',
  ),
  'stops.txt': lines(
    'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station',
    'STN,Central Station,36.425288,-117.133162,1,',
    'STN_A,Central Station Platform A,36.4253,-117.1331,0,STN',
    'BEATTY,Beatty Airport,36.868446,-116.784582,0,',
    'NADAV,North Ave / D Ave N,36.914893,-116.76821,0,',
    'FUR,Furnace Creek,36.641496,-116.40094,0,',
  ),
  'routes.txt': lines(
    'route_id,agency_id,route_short_name,route_long_name,route_type,route_color',
    'R10,DTA,10,Airport - Central,3,FF0000',
    'R20,DTA,20,Central - Furnace Creek,3,#00FF00',
    'R30,DTA,30,Harbor Ferry,4,green',
  ),
  'trips.txt': lines(
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id',
    'R10,WKDY,T10_1,Central,0,SH10',
    'R10,WKDY,T10_2,Central,0,SH10',
    'R10,WKDY,T10_3,Airport,1,SH10',
    'R20,WKDY,T20_1,Furnace Creek,0,',
    'R20,WKND,T20_2,Furnace Creek,0,',
  ),
  'stop_times.txt': lines(
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'T10_1,08:00:00,08:00:00,BEATTY,1',
    'T10_1,,,NADAV,2',
    'T10_1,08:20:00,08:20:00,STN_A,3',
    'T10_2,23:50:00,23:50:00,BEATTY,1',
    'T10_2,24:05:00,24:05:00,NADAV,2',
    'T10_2,24:20:00,24:20:00,STN_A,3',
    'T10_3,9:00:00,9:00:00,STN_A,1',
    'T10_3,09:20:00,09:20:00,NADAV,2',
    'T10_3,09:30:00,09:30:00,BEATTY,3',
    'T20_1,10:00:00,10:00:00,STN_A,1',
    'T20_1,11:00:00,11:00:00,FUR,2',
    'T20_2,12:00:00,12:00:00,STN_A,1',
    'T20_2,13:00:00,13:00:00,FUR,2',
  ),
  'calendar.txt': lines(
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WKDY,1,1,1,1,1,0,0,20260101,20261231',
    'WKND,0,0,0,0,0,1,1,20260101,20261231',
  ),
  'calendar_dates.txt': lines(
    'service_id,date,exception_type',
    'WKDY,20261126,2',
    'WKND,20261126,1',
  ),
  'shapes.txt': lines(
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    'SH10,36.868446,-116.784582,1',
    'SH10,36.9,-116.77,2',
    'SH10,36.914893,-116.76821,3',
    'SH10,36.4253,-117.1331,4',
  ),
  'feed_info.txt': lines(
    'feed_publisher_name,feed_publisher_url,feed_lang,feed_version',
    'Demo Publisher,https://example.com,en,2026.10',
  ),
  'transfers.txt': lines('from_stop_id,to_stop_id,transfer_type', 'STN_A,FUR,0'),
};

export function makeZip(files: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

export function streamOf(bytes: Uint8Array, chunkSize = 4096): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

export function withoutFile(name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(SAMPLE_FEED).filter(([file]) => file !== name));
}

export function withFile(name: string, text: string): Record<string, string> {
  return {...SAMPLE_FEED, [name]: text};
}

export const SAMPLE_TRANSLATIONS = lines(
  'table_name,field_name,language,translation,record_id,record_sub_id,field_value',
  'stops,stop_name,fr,Gare Centrale,STN,,', // 2
  'stops,stop_name,fr,Aéroport de Beatty,BEATTY,,', // 3
  'stops,stop_name,fr,Avenue Nord / Avenue D,,,North Ave / D Ave N', // 4: by value
  'stops,stop_name,fr,Quai A,STN_A,,', // 5: id beats value (line 6)
  'stops,stop_name,fr,Quai (par valeur),,,Central Station Platform A', // 6
  'stops,stop_name,fr,Quai A bis,STN_A,,', // 7: duplicate of 5, loses
  'routes,route_long_name,fr,Aéroport - Centre,R10,,', // 8
  'trips,trip_headsign,fr,Centre,,,Central', // 9
  'agency,agency_name,fr,Régie de transport démo,DTA,,', // 10
  'feed_info,feed_publisher_name,fr,Éditeur démo,,,', // 11
  'stops,stop_name,fr,Sans clé,,,', // 12: invalid, neither key
  'stops,stop_name,fr,Deux clés,FUR,,Furnace Creek', // 13: invalid, both keys
  'stops,stop_name,fr,,FUR,,', // 14: empty translation
  'stops,stop_name,DE,Zentralbahnhof,STN,,', // 15
);
export const LEGACY_TRANSLATIONS = lines('trans_id,lang,translation', 'Central Station,fr,Gare Centrale');
export const TRANSLATED_FEED: Readonly<Record<string, string>> = withFile(
  'translations.txt',
  SAMPLE_TRANSLATIONS,
);

/** SAMPLE_FEED with its defects fixed: validates with zero issues. */
export const VALID_FEED: Readonly<Record<string, string>> = {
  ...SAMPLE_FEED,
  'trips.txt': lines(
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id',
    'R10,WKDY,T10_1,Central,0,SH10',
    'R10,WKDY,T10_2,Central,0,SH10',
    'R10,WKDY,T10_3,Airport,1,SH10',
    'R20,WKDY,T20_1,Furnace Creek,0,',
    'R20,WKND,T20_2,Furnace Creek,0,',
    'R30,WKDY,T30_1,Central,0,',
  ),
  'stop_times.txt': lines(
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'T10_1,08:00:00,08:00:00,BEATTY,1',
    'T10_1,,,NADAV,2',
    'T10_1,09:00:00,09:00:00,STN_A,3',
    'T10_2,23:50:00,23:50:00,BEATTY,1',
    'T10_2,24:05:00,24:05:00,NADAV,2',
    'T10_2,25:05:00,25:05:00,STN_A,3',
    'T10_3,9:00:00,9:00:00,STN_A,1',
    'T10_3,09:50:00,09:50:00,NADAV,2',
    'T10_3,10:00:00,10:00:00,BEATTY,3',
    'T20_1,10:00:00,10:00:00,STN_A,1',
    'T20_1,11:00:00,11:00:00,FUR,2',
    'T20_2,12:00:00,12:00:00,STN_A,1',
    'T20_2,13:00:00,13:00:00,FUR,2',
    'T30_1,14:00:00,14:00:00,FUR,1',
    'T30_1,16:00:00,16:00:00,STN_A,2',
  ),
  'calendar.txt': lines(
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'WKDY,1,1,1,1,1,0,0,20260101,20991231',
    'WKND,0,0,0,0,0,1,1,20260101,20991231',
  ),
};
