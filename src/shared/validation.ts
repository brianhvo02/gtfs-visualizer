import type {IssueCode, IssueSeverity} from './types.ts';

export const RULESET_VERSION = 1;
export const STORED_ISSUE_CAP = 200;

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type RuleId =
  | 'trip_unknown_route'
  | 'trip_unknown_service'
  | 'trip_unknown_shape'
  | 'stop_unknown_parent'
  | 'stop_time_unknown_trip'
  | 'stop_time_unknown_stop'
  | 'stop_times_out_of_order'
  | 'trip_too_few_stops'
  | 'unrealistic_speed'
  | 'stop_far_from_shape'
  | 'route_without_trips'
  | 'stop_unused'
  | 'service_never_active'
  | 'stop_invalid_coords'
  | 'stops_near_duplicate'
  | 'feed_expired'
  | 'feed_not_yet_active'
  | 'route_color_contrast';

export interface RuleInfo {
  readonly severity: ValidationSeverity;
  readonly title: string;
  readonly description: string;
}

export const RULES: Readonly<Record<RuleId, RuleInfo>> = {
  trip_unknown_route: {
    severity: 'error',
    title: 'Trip refers to a missing route',
    description: "The trip's route_id isn't in routes.txt, so the trip is not shown.",
  },
  trip_unknown_service: {
    severity: 'error',
    title: 'Trip refers to a missing service',
    description: "The trip's service_id isn't in calendar.txt or calendar_dates.txt, so it never runs.",
  },
  trip_unknown_shape: {
    severity: 'warning',
    title: 'Trip refers to a missing shape',
    description: 'The shape has no points, so the line is drawn straight between stops.',
  },
  stop_unknown_parent: {
    severity: 'error',
    title: 'Stop has an invalid parent station',
    description: 'The parent_station is missing or is the wrong kind of location.',
  },
  stop_time_unknown_trip: {
    severity: 'error',
    title: 'Stop times for a missing trip',
    description: "stop_times.txt lists a trip that isn't in trips.txt.",
  },
  stop_time_unknown_stop: {
    severity: 'error',
    title: 'Stop time at a missing stop',
    description: "A trip stops at a stop that isn't in stops.txt.",
  },
  stop_times_out_of_order: {
    severity: 'error',
    title: 'Times go backwards',
    description: 'A trip arrives at a stop earlier than it left the previous one.',
  },
  trip_too_few_stops: {
    severity: 'error',
    title: 'Trip has fewer than two stops',
    description: 'A trip needs at least two stop times to go anywhere.',
  },
  unrealistic_speed: {
    severity: 'warning',
    title: 'Unrealistic speed',
    description: 'A vehicle would have to travel faster than is plausible for its mode.',
  },
  stop_far_from_shape: {
    severity: 'warning',
    title: "Stop far from the route's line",
    description: 'The stop is more than 100 m from the shape its trips follow.',
  },
  route_without_trips: {
    severity: 'warning',
    title: 'Route has no trips',
    description: 'The route is listed but nothing runs on it.',
  },
  stop_unused: {
    severity: 'warning',
    title: 'Stop not served',
    description: 'No trip stops here.',
  },
  service_never_active: {
    severity: 'warning',
    title: 'Service never runs',
    description: "The service's calendar and exceptions leave no dates on which it runs.",
  },
  stop_invalid_coords: {
    severity: 'error',
    title: 'Stop has invalid coordinates',
    description: 'Coordinates are missing, out of range, or exactly 0,0.',
  },
  stops_near_duplicate: {
    severity: 'info',
    title: 'Possible duplicate stops',
    description: 'Two stops with the same name are less than 2 m apart.',
  },
  feed_expired: {
    severity: 'warning',
    title: 'Feed has expired',
    description: 'Service in this feed has ended.',
  },
  feed_not_yet_active: {
    severity: 'warning',
    title: 'Feed not yet active',
    description: "Service in this feed hasn't started yet.",
  },
  route_color_contrast: {
    severity: 'info',
    title: 'Low contrast route colors',
    description: "The route's text color is hard to read on its route color.",
  },
};

export const RULE_IDS: readonly RuleId[] = [
  'trip_unknown_route',
  'trip_unknown_service',
  'trip_unknown_shape',
  'stop_unknown_parent',
  'stop_time_unknown_trip',
  'stop_time_unknown_stop',
  'stop_times_out_of_order',
  'trip_too_few_stops',
  'unrealistic_speed',
  'stop_far_from_shape',
  'route_without_trips',
  'stop_unused',
  'service_never_active',
  'stop_invalid_coords',
  'stops_near_duplicate',
  'feed_expired',
  'feed_not_yet_active',
  'route_color_contrast',
];

export type IssueDetails = Readonly<Record<string, string | number>>;

export interface ValidationIssue {
  readonly ruleId: RuleId;
  readonly severity: ValidationSeverity;
  readonly routeId: string | null;
  readonly routeName: string | null;
  readonly stopId: string | null;
  readonly stopName: string | null;
  readonly tripId: string | null;
  readonly message: string;
  readonly details: IssueDetails | null;
}

export type ValidationFilter =
  | {readonly ruleId: RuleId}
  | {readonly routeId: string}
  | {readonly stopId: string};

export interface ValidationProgress {
  readonly checkIndex: number;
  readonly checkCount: number;
}

export interface ValidationCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
}

/** Stored results that match RULESET_VERSION. */
export interface CurrentValidation {
  readonly state: 'current';
  readonly counts: ValidationCounts;
  /**
   * Rules whose check threw; their counts are missing from `counts`. Counted per rule, like the report's
   * "This check couldn't run" entries, so one check owning two rules counts twice.
   */
  readonly failedRules: number;
}

export type ValidationStatus =
  | CurrentValidation
  | {readonly state: 'cancelled'}
  | {readonly state: 'failed'; readonly message: string};

export interface RuleResult {
  readonly ruleId: RuleId;
  readonly severity: ValidationSeverity;
  readonly total: number;
  readonly stored: number;
  readonly errorMessage: string | null;
}

export interface ImportIssueGroup {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly count: number;
}

export interface ValidationSummary {
  readonly counts: ValidationCounts;
  /** Only rules with total > 0 or errorMessage !== null, in RULE_IDS order. */
  readonly rules: readonly RuleResult[];
  readonly importIssues: readonly ImportIssueGroup[];
}

/** "3 errors · 12 warnings · 4 info"; zero counts omitted; "" when all zero. */
export function formatCounts(counts: ValidationCounts): string {
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(`${counts.error} ${counts.error === 1 ? 'error' : 'errors'}`);
  }
  if (counts.warning > 0) {
    parts.push(`${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}`);
  }
  if (counts.info > 0) {
    parts.push(`${counts.info} info`);
  }
  return parts.join(' · ');
}

/** "2 checks couldn't run"; "" when none failed. */
export function formatFailedRules(failedRules: number): string {
  if (failedRules === 0) return '';
  return `${failedRules} ${failedRules === 1 ? 'check' : 'checks'} couldn't run`;
}
