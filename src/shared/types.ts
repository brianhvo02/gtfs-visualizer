import type {RouteCategory} from '../gtfs/route-types.ts';

export type IssueSeverity = 'fatal' | 'error' | 'warning';

export type IssueCode =
  | 'missing_file'
  | 'missing_calendar'
  | 'missing_column'
  | 'missing_value'
  | 'empty_file'
  | 'duplicate_file'
  | 'ragged_row'
  | 'invalid_value'
  | 'csv_syntax'
  | 'zip_error'
  | 'invalid_timezone'
  | 'suppressed';

export interface ImportIssue {
  readonly severity: IssueSeverity;
  readonly file: string | null;
  readonly line: number | null;
  readonly column: string | null;
  readonly code: IssueCode;
  readonly message: string;
}

export type ImportStage = 'parse' | 'index' | 'derive' | 'register';

export interface ImportProgress {
  readonly stage: ImportStage;
  readonly file?: string;
  readonly rowsDone?: number;
  readonly bytesDone?: number;
  readonly bytesTotal?: number | null;
}

export interface RouteSummary {
  readonly routeId: string;
  readonly agencyId: string | null;
  readonly shortName: string | null;
  readonly longName: string | null;
  readonly routeType: number;
  readonly category: RouteCategory;
  readonly color: string;
  readonly textColor: string;
  readonly sortOrder: number | null;
}

export interface StopRef {
  readonly stopId: string;
  readonly name: string;
  readonly lat: number | null;
  readonly lon: number | null;
}

export interface PatternSummary {
  readonly patternId: string;
  readonly directionId: number;
  readonly headsign: string | null;
  readonly tripCount: number;
  readonly shapeId: string | null;
  readonly stops: readonly StopRef[];
}

export interface RouteDetail {
  readonly route: RouteSummary;
  readonly patterns: readonly PatternSummary[];
}

export interface StopInfo {
  readonly stopId: string;
  readonly name: string;
  readonly code: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly locationType: number;
  readonly parentStation: string | null;
}

export interface StopDetail {
  readonly stop: StopInfo;
  readonly routes: readonly RouteSummary[];
}

export interface Departure {
  readonly tripId: string;
  readonly stopId: string;
  readonly routeId: string;
  readonly routeShortName: string | null;
  readonly routeLongName: string | null;
  readonly routeColor: string;
  readonly routeTextColor: string;
  readonly headsign: string | null;
  /** Seconds past midnight of the requested service date; may exceed 86400. */
  readonly departureSecs: number;
}

export interface AgencyInfo {
  readonly name: string;
  readonly url: string | null;
  readonly timezone: string | null;
}

export interface FeedInfoRow {
  readonly publisherName: string | null;
  readonly version: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

export interface FeedSummary {
  readonly agencies: readonly AgencyInfo[];
  readonly feedInfo: FeedInfoRow | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly serviceStart: string | null;
  readonly serviceEnd: string | null;
  readonly timezone: string | null;
  readonly issueCount: number;
}

export interface RouteShapeProps {
  readonly routeId: string;
  readonly shapeId: string;
  readonly color: string;
  readonly name: string;
}

export interface StopProps {
  readonly stopId: string;
  readonly name: string;
  readonly locationType: number;
}
