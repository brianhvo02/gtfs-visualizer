import {todayInTimeZone} from '../../gtfs/time.ts';
import {
  STORED_ISSUE_CAP,
  type IssueDetails,
  type RuleId,
  type ValidationProgress,
  type ValidationStatus,
} from '../../shared/validation.ts';
import {asString} from '../sql-values.ts';
import type {Database} from '../sqlite.ts';
import {getCurrentCounts, writeValidationResults, type RuleBuffer} from './store.ts';

export interface EmittedIssue {
  readonly routeId?: string | null;
  readonly stopId?: string | null;
  readonly tripId?: string | null;
  readonly message: string;
  readonly details?: IssueDetails;
}

export interface CheckContext {
  readonly db: Database;
  /** Today as YYYYMMDD in the feed's time zone. */
  readonly today: string;
  /** Records an issue; throws if `ruleId` is not one of the running check's `ruleIds`. */
  emit(ruleId: RuleId, issue: EmittedIssue): void;
  /** Yields a macrotask so queued queries run; throws ValidationCancelled if cancelled. */
  checkpoint(): Promise<void>;
}

export interface ValidationCheck {
  readonly ruleIds: readonly RuleId[];
  run(ctx: CheckContext): Promise<void>;
}

export interface CancelToken {
  cancelled: boolean;
}

export class ValidationCancelled extends Error {}

export interface RunOptions {
  readonly now: Date;
  readonly token: CancelToken;
  readonly checks: readonly ValidationCheck[];
  readonly onProgress?: (progress: ValidationProgress) => void;
}

interface MutableBuffer {
  total: number;
  issues: EmittedIssue[];
  errorMessage: string | null;
}

function feedTimeZone(db: Database): string | null {
  const value = db.selectValue("SELECT value FROM feed_summary WHERE key = 'timezone'");
  return asString(value);
}

/** Runs every check, buffering results, then stores them atomically. */
export async function runValidation(db: Database, options: RunOptions): Promise<ValidationStatus> {
  const {token, checks, now} = options;
  const today = todayInTimeZone(feedTimeZone(db), now);
  const buffers = new Map<RuleId, MutableBuffer>();
  const checkpoint = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (token.cancelled) throw new ValidationCancelled('validation cancelled');
  };
  try {
    for (const [checkIndex, check] of checks.entries()) {
      options.onProgress?.({checkIndex, checkCount: checks.length});
      const own = new Map<RuleId, MutableBuffer>();
      for (const ruleId of check.ruleIds) own.set(ruleId, {total: 0, issues: [], errorMessage: null});
      const ctx: CheckContext = {
        db,
        today,
        checkpoint,
        emit(ruleId, issue) {
          const buffer = own.get(ruleId);
          if (buffer === undefined) throw new Error(`Check does not own rule ${ruleId}`);
          buffer.total++;
          if (buffer.issues.length < STORED_ISSUE_CAP) buffer.issues.push(issue);
        },
      };
      try {
        await check.run(ctx);
      } catch (error) {
        if (error instanceof ValidationCancelled) throw error;
        const message = error instanceof Error ? error.message : String(error);
        for (const buffer of own.values()) {
          buffer.total = 0;
          buffer.issues = [];
          buffer.errorMessage = message;
        }
      }
      for (const [ruleId, buffer] of own) buffers.set(ruleId, buffer);
      await checkpoint();
    }
  } catch (error) {
    if (error instanceof ValidationCancelled) return {state: 'cancelled'};
    throw error;
  }
  const results: RuleBuffer[] = [...buffers].map(([ruleId, buffer]) => ({ruleId, ...buffer}));
  try {
    writeValidationResults(db, results, now.toISOString());
    const counts = getCurrentCounts(db);
    if (counts === null) return {state: 'failed', message: 'Validation results were not stored.'};
    return {state: 'current', counts};
  } catch (error) {
    return {state: 'failed', message: error instanceof Error ? error.message : String(error)};
  }
}
