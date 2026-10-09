import type {PreparedStatement} from '@sqlite.org/sqlite-wasm';
import type {ImportIssue} from '../shared/types.ts';
import type {Database} from './sqlite.ts';

const DEFAULT_CAP = 100;

/** Records import issues, storing at most `cap` rows per (file, code) so broken feeds stay fast. */
export class IssueCollector {
  private readonly insert: PreparedStatement;
  private readonly cap: number;
  private readonly counts = new Map<string, {file: string | null; code: string; count: number}>();
  private readonly fatal: ImportIssue[] = [];
  private total = 0;

  constructor(db: Database, cap = DEFAULT_CAP) {
    this.cap = cap;
    this.insert = db.prepare(
      'INSERT INTO import_issues (severity, file, line, column_name, code, message) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }

  add(issue: ImportIssue): void {
    this.total++;
    if (issue.severity === 'fatal') this.fatal.push(issue);
    const key = `${issue.file ?? ''}\u0000${issue.code}`;
    const entry = this.counts.get(key) ?? {file: issue.file, code: issue.code, count: 0};
    entry.count++;
    this.counts.set(key, entry);
    if (entry.count > this.cap) return;
    this.insert
      .bind([issue.severity, issue.file, issue.line, issue.column, issue.code, issue.message])
      .stepReset();
  }

  hasFatal(): boolean {
    return this.fatal.length > 0;
  }

  fatalIssues(): readonly ImportIssue[] {
    return this.fatal;
  }

  totalCount(): number {
    return this.total;
  }

  finish(): void {
    for (const entry of this.counts.values()) {
      if (entry.count <= this.cap) continue;
      const where = entry.file === null ? '' : ` in ${entry.file}`;
      this.insert
        .bind([
          'warning',
          entry.file,
          null,
          null,
          'suppressed',
          `${entry.count - this.cap} more "${entry.code}" issues${where} were not recorded.`,
        ])
        .stepReset();
    }
    this.insert.finalize();
  }
}
