import type {ImportIssue, IssueCode, IssueSeverity} from '../../shared/types.ts';
import {
  RULE_IDS,
  RULES,
  RULESET_VERSION,
  type IssueDetails,
  type RuleId,
  type RuleResult,
  type ValidationCounts,
  type ValidationFilter,
  type ValidationIssue,
  type ValidationSeverity,
  type ValidationSummary,
} from '../../shared/validation.ts';
import {asNumber, asString} from '../sql-values.ts';
import type {Database} from '../sqlite.ts';
import type {EmittedIssue} from './runner.ts';

export interface RuleBuffer {
  readonly ruleId: RuleId;
  readonly total: number;
  readonly issues: readonly EmittedIssue[];
  readonly errorMessage: string | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS validation_issues (
    rule_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    route_id TEXT,
    stop_id TEXT,
    trip_id TEXT,
    message TEXT NOT NULL,
    details_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_validation_issues_rule_id ON validation_issues (rule_id);
  CREATE INDEX IF NOT EXISTS idx_validation_issues_route_id ON validation_issues (route_id);
  CREATE INDEX IF NOT EXISTS idx_validation_issues_stop_id ON validation_issues (stop_id);
  CREATE TABLE IF NOT EXISTS validation_rules (
    rule_id TEXT PRIMARY KEY,
    severity TEXT NOT NULL,
    total INTEGER NOT NULL,
    error_message TEXT
  );
  CREATE TABLE IF NOT EXISTS validation_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const SEVERITY_RANK_SQL = "CASE i.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END";

/** Replaces all stored validation results in one transaction. */
export function writeValidationResults(db: Database, buffers: readonly RuleBuffer[], completedAt: string): void {
  db.exec(SCHEMA);
  const insertRule = db.prepare('INSERT INTO validation_rules VALUES (?, ?, ?, ?)');
  const insertIssue = db.prepare(
    'INSERT INTO validation_issues (rule_id, severity, route_id, stop_id, trip_id, message, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const upsertMeta = db.prepare(
    'INSERT INTO validation_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  try {
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM validation_issues; DELETE FROM validation_rules;');
      for (const buffer of buffers) {
        const severity = RULES[buffer.ruleId].severity;
        insertRule.bind([buffer.ruleId, severity, buffer.total, buffer.errorMessage]).stepReset();
        for (const issue of buffer.issues) {
          insertIssue
            .bind([
              buffer.ruleId,
              severity,
              issue.routeId ?? null,
              issue.stopId ?? null,
              issue.tripId ?? null,
              issue.message,
              issue.details === undefined ? null : JSON.stringify(issue.details),
            ])
            .stepReset();
        }
      }
      upsertMeta.bind(['ruleset_version', String(RULESET_VERSION)]).stepReset();
      upsertMeta.bind(['completed_at', completedAt]).stepReset();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    insertRule.finalize();
    insertIssue.finalize();
    upsertMeta.finalize();
  }
}

function hasValidationTables(db: Database): boolean {
  const rows = db.selectValues(
    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('validation_issues', 'validation_rules', 'validation_meta')",
  );
  return asNumber(rows[0]) === 3;
}

function isCurrent(db: Database): boolean {
  if (!hasValidationTables(db)) return false;
  const value = db.selectValue("SELECT value FROM validation_meta WHERE key = 'ruleset_version'");
  return asString(value) === String(RULESET_VERSION);
}

function countsOf(db: Database): ValidationCounts {
  const counts = {error: 0, warning: 0, info: 0};
  const rows = db.selectObjects('SELECT severity, sum(total) AS total FROM validation_rules GROUP BY severity');
  for (const row of rows) {
    const severity = asString(row['severity']);
    if (severity === 'error' || severity === 'warning' || severity === 'info') {
      counts[severity] = asNumber(row['total']) ?? 0;
    }
  }
  return counts;
}

/** Counts when stored results match RULESET_VERSION; null when tables are missing or outdated. */
export function getCurrentCounts(db: Database): ValidationCounts | null {
  return isCurrent(db) ? countsOf(db) : null;
}

export function getValidationSummary(db: Database): ValidationSummary | null {
  if (!isCurrent(db)) return null;
  const stored = new Map<string, number>();
  for (const row of db.selectObjects('SELECT rule_id, count(*) AS n FROM validation_issues GROUP BY rule_id')) {
    stored.set(asString(row['rule_id']) ?? '', asNumber(row['n']) ?? 0);
  }
  const byRule = new Map<string, RuleResult>();
  for (const row of db.selectObjects('SELECT rule_id, severity, total, error_message FROM validation_rules')) {
    const ruleId = asString(row['rule_id']) ?? '';
    if (!isRuleId(ruleId)) continue;
    byRule.set(ruleId, {
      ruleId,
      severity: RULES[ruleId].severity,
      total: asNumber(row['total']) ?? 0,
      stored: stored.get(ruleId) ?? 0,
      errorMessage: asString(row['error_message']),
    });
  }
  const rules: RuleResult[] = [];
  for (const ruleId of RULE_IDS) {
    const rule = byRule.get(ruleId);
    if (rule !== undefined && (rule.total > 0 || rule.errorMessage !== null)) rules.push(rule);
  }
  const importIssues = db
    .selectObjects(
      "SELECT code, severity, count(*) AS n FROM import_issues WHERE code != 'suppressed' GROUP BY code, severity ORDER BY min(rowid)",
    )
    .map((row) => ({
      code: (asString(row['code']) ?? '') as IssueCode,
      severity: (asString(row['severity']) ?? 'warning') as IssueSeverity,
      count: asNumber(row['n']) ?? 0,
    }));
  return {counts: countsOf(db), rules, importIssues};
}

function isRuleId(value: string): value is RuleId {
  return Object.hasOwn(RULES, value);
}

function parseDetails(json: string | null): IssueDetails | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as IssueDetails;
  } catch {
    return null;
  }
}

export function getValidationIssues(db: Database, filter: ValidationFilter): ValidationIssue[] {
  if (!isCurrent(db)) return [];
  let where: string;
  let bind: string[];
  if ('ruleId' in filter) {
    where = 'i.rule_id = ?';
    bind = [filter.ruleId];
  } else if ('routeId' in filter) {
    where = 'i.route_id = ?';
    bind = [filter.routeId];
  } else {
    where = 'i.stop_id IN (SELECT stop_id FROM stops WHERE stop_id = ? OR parent_station = ?)';
    bind = [filter.stopId, filter.stopId];
  }
  const rows = db.selectObjects(
    `SELECT i.rule_id, i.severity, i.route_id, i.stop_id, i.trip_id, i.message, i.details_json,
            COALESCE(r.route_short_name, r.route_long_name, r.route_id) AS route_name,
            COALESCE(s.stop_name, s.stop_id) AS stop_name
     FROM validation_issues i
     LEFT JOIN routes r ON r.route_id = i.route_id
     LEFT JOIN stops s ON s.stop_id = i.stop_id
     WHERE ${where}
     ORDER BY ${SEVERITY_RANK_SQL}, i.rule_id, i.rowid`,
    bind,
  );
  const issues: ValidationIssue[] = [];
  for (const row of rows) {
    const ruleId = asString(row['rule_id']) ?? '';
    if (!isRuleId(ruleId)) continue;
    issues.push({
      ruleId,
      severity: (asString(row['severity']) ?? 'warning') as ValidationSeverity,
      routeId: asString(row['route_id']),
      routeName: asString(row['route_name']),
      stopId: asString(row['stop_id']),
      stopName: asString(row['stop_name']),
      tripId: asString(row['trip_id']),
      message: asString(row['message']) ?? '',
      details: parseDetails(asString(row['details_json'])),
    });
  }
  return issues;
}

export function getImportIssues(db: Database, code: IssueCode): ImportIssue[] {
  return db
    .selectObjects(
      'SELECT severity, file, line, column_name, code, message FROM import_issues WHERE code = ? ORDER BY rowid',
      [code],
    )
    .map((row) => ({
      severity: (asString(row['severity']) ?? 'warning') as IssueSeverity,
      file: asString(row['file']),
      line: asNumber(row['line']),
      column: asString(row['column_name']),
      code,
      message: asString(row['message']) ?? '',
    }));
}
