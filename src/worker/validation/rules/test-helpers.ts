import type {ValidationIssue} from '../../../shared/validation.ts';
import {loadSampleDb} from '../../../test-fixtures/sample-db.ts';
import {VALID_FEED} from '../../../test-fixtures/sample-feed.ts';
import {runValidation, type ValidationCheck} from '../runner.ts';
import {getValidationIssues} from '../store.ts';

/** VALID_FEED with one file replaced. */
export function withValidFile(name: string, text: string): Record<string, string> {
  return {...VALID_FEED, [name]: text};
}

/** Runs one check against a feed and returns the stored issues for all of its rules. */
export async function runCheck(
  check: ValidationCheck,
  files?: Readonly<Record<string, string>>,
  now: Date = new Date('2026-10-10T12:00:00Z'),
): Promise<ValidationIssue[]> {
  const {db} = await loadSampleDb(files);
  await runValidation(db, {now, token: {cancelled: false}, checks: [check]});
  return check.ruleIds.flatMap((ruleId) => getValidationIssues(db, {ruleId}));
}
