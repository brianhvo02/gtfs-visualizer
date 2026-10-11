import {useState, type ReactElement} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {IssueCode} from '../shared/types.ts';
import {
  RULES,
  type RuleResult,
  type ValidationSeverity,
  type ValidationStatus,
} from '../shared/validation.ts';
import {ErrorMessage} from './error-message.tsx';
import {useAsync} from './use-async.ts';

export interface IssuesReportProps {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly validation: ValidationStatus | null;
  readonly onBack: () => void;
  readonly onOpenRoute: (routeId: string) => void;
  readonly onOpenStop: (stopId: string) => void;
}

const SECTIONS: readonly {readonly severity: ValidationSeverity; readonly title: string}[] = [
  {severity: 'error', title: 'Errors'},
  {severity: 'warning', title: 'Warnings'},
  {severity: 'info', title: 'Info'},
];

export function IssuesReport({
  service,
  feedId,
  validation,
  onBack,
  onOpenRoute,
  onOpenStop,
}: IssuesReportProps): ReactElement {
  const current = validation?.state === 'current';
  const summary = useAsync(async () => (current ? await service.getValidationSummary(feedId) : null), [
    service,
    feedId,
    current,
    validation,
  ]);
  let body: ReactElement;
  if (!current) {
    body = <p className="muted">Checking feed…</p>;
  } else if (summary.status === 'loading') {
    body = <p className="muted">Loading issues…</p>;
  } else if (summary.status === 'error') {
    body = <ErrorMessage error={summary.error} />;
  } else if (summary.value === null) {
    body = <p className="muted">Checking feed…</p>;
  } else {
    const {rules, importIssues} = summary.value;
    body = (
      <>
        {SECTIONS.map(({severity, title}) => {
          const inSection = rules.filter((rule) => rule.severity === severity);
          if (inSection.length === 0) return null;
          return (
            <section key={severity} aria-label={title}>
              <h3>{title}</h3>
              {inSection.map((rule) => (
                <RuleDetails
                  key={rule.ruleId}
                  service={service}
                  feedId={feedId}
                  validation={validation}
                  rule={rule}
                  onOpenRoute={onOpenRoute}
                  onOpenStop={onOpenStop}
                />
              ))}
            </section>
          );
        })}
        {importIssues.length > 0 && (
          <section aria-label="Import notes">
            <h3>Import notes</h3>
            {importIssues.map((group) => (
              <ImportNoteDetails
                key={group.code}
                service={service}
                feedId={feedId}
                code={group.code}
                count={group.count}
              />
            ))}
          </section>
        )}
      </>
    );
  }
  return (
    <section className="panel">
      <button type="button" className="link" onClick={onBack}>
        ← Back to feed
      </button>
      <h2>Feed issues</h2>
      {body}
    </section>
  );
}

interface RuleProps {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly validation: ValidationStatus | null;
  readonly rule: RuleResult;
  readonly onOpenRoute: (routeId: string) => void;
  readonly onOpenStop: (stopId: string) => void;
}

function RuleDetails(props: RuleProps): ReactElement {
  const [open, setOpen] = useState(false);
  const {rule} = props;
  const info = RULES[rule.ruleId];
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {info.title} ({rule.total.toLocaleString()})
      </summary>
      <p className="muted">{info.description}</p>
      {open && <RuleIssues {...props} />}
    </details>
  );
}

function RuleIssues({service, feedId, validation, rule, onOpenRoute, onOpenStop}: RuleProps): ReactElement {
  const ruleId = rule.ruleId;
  const state = useAsync(
    async () => await service.getValidationIssues(feedId, {ruleId}),
    [service, feedId, ruleId, validation],
  );
  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <ErrorMessage error={state.error} />;
  return (
    <>
      {rule.errorMessage !== null && <p role="status">This check couldn't run: {rule.errorMessage}</p>}
      {rule.stored < rule.total && (
        <p className="muted">
          Showing {rule.stored} of {rule.total.toLocaleString()}
        </p>
      )}
      <ul>
        {state.value.map((issue, index) => (
          <li key={index}>
            {issue.message}{' '}
            {issue.routeName !== null && issue.routeId !== null ? (
              <button type="button" className="link" onClick={() => onOpenRoute(issue.routeId ?? '')}>
                Open route {issue.routeName}
              </button>
            ) : issue.stopName !== null && issue.stopId !== null ? (
              <button type="button" className="link" onClick={() => onOpenStop(issue.stopId ?? '')}>
                Open stop {issue.stopName}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function ImportNoteDetails({
  service,
  feedId,
  code,
  count,
}: {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly code: IssueCode;
  readonly count: number;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {code} ({count})
      </summary>
      {open && <ImportNotes service={service} feedId={feedId} code={code} />}
    </details>
  );
}

function ImportNotes({
  service,
  feedId,
  code,
}: {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly code: IssueCode;
}): ReactElement {
  const state = useAsync(async () => await service.getImportIssues(feedId, code), [service, feedId, code]);
  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <ErrorMessage error={state.error} />;
  return (
    <ul>
      {state.value.map((issue, index) => (
        <li key={index}>{issue.message}</li>
      ))}
    </ul>
  );
}
