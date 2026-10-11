import type {ReactElement} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {ValidationFilter, ValidationStatus} from '../shared/validation.ts';
import {useAsync} from './use-async.ts';

export interface EntityIssuesProps {
  readonly service: FeedApi;
  readonly feedId: string;
  readonly validation: ValidationStatus | null;
  readonly filter: {readonly routeId: string} | {readonly stopId: string};
}

/** Validation issues for one route or stop; renders nothing when there are none. */
export function EntityIssues({service, feedId, validation, filter}: EntityIssuesProps): ReactElement | null {
  const routeId = 'routeId' in filter ? filter.routeId : null;
  const stopId = 'stopId' in filter ? filter.stopId : null;
  const current = validation?.state === 'current';
  const state = useAsync(async () => {
    if (!current) return [];
    const issueFilter: ValidationFilter = routeId !== null ? {routeId} : {stopId: stopId ?? ''};
    return await service.getValidationIssues(feedId, issueFilter);
  }, [service, feedId, routeId, stopId, current, validation]);
  if (state.status !== 'ok' || state.value.length === 0) return null;
  return (
    <section aria-label="Issues">
      <h3>Issues ({state.value.length})</h3>
      <ul>
        {state.value.map((issue, index) => (
          <li key={`${issue.ruleId}-${index}`}>{issue.message}</li>
        ))}
      </ul>
    </section>
  );
}
