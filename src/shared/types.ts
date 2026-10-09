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
