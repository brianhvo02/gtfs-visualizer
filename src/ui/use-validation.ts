import * as Comlink from 'comlink';
import {useEffect, useState} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {ValidationProgress, ValidationStatus} from '../shared/validation.ts';
import {useAsync, type AsyncState} from './use-async.ts';

/** Automatic re-runs after an interrupted (cancelled) validation, per feed. */
export const MAX_AUTO_RETRIES = 2;

export interface ValidationView {
  readonly status: AsyncState<ValidationStatus>;
  /** Progress of the run for the current feed; null when unknown. */
  readonly progress: ValidationProgress | null;
  /** Runs the check again (used after an interrupted run). */
  readonly retry: () => void;
}

/** Whether a resolved status for the shown feed is an interrupted run that still has automatic retries left. */
export function shouldAutoRetry(
  status: AsyncState<ValidationStatus>,
  feedId: string | null,
  autoRetries: number,
  maxRetries: number,
): boolean {
  return feedId !== null && status.status === 'ok' && status.value.state === 'cancelled' && autoRetries < maxRetries;
}

export interface RunState {
  readonly feedId: string | null;
  /** Changes whenever the run should be repeated; part of the useAsync deps. */
  readonly attempt: number;
  readonly auto: number;
}

/** The run state for the shown feed: the stored one, or a fresh retry budget when the feed changed. */
export function runStateFor(stored: RunState, feedId: string | null): RunState {
  return stored.feedId === feedId ? stored : {feedId, attempt: 0, auto: 0};
}

/** Ensures the feed's validation results are current, reporting check progress while it runs. */
export function useValidation(service: FeedApi, feedId: string | null): ValidationView {
  const [tagged, setTagged] = useState<{readonly feedId: string; readonly p: ValidationProgress} | null>(null);
  const [stored, setStored] = useState<RunState>({feedId, attempt: 0, auto: 0});
  const run = runStateFor(stored, feedId);
  // Store the fresh budget as soon as the feed changes (React's "adjust state when a prop changes" pattern), so
  // returning to a feed that spent its retries starts over instead of finding its old state still stored.
  if (run !== stored) setStored(run);
  const status = useAsync<ValidationStatus>(
    async () =>
      feedId === null
        ? {state: 'cancelled'}
        : await service.ensureValidation(
            feedId,
            Comlink.proxy((p: ValidationProgress) => setTagged({feedId, p})),
          ),
    [service, feedId, run.attempt],
  );
  const autoRetry = shouldAutoRetry(status, feedId, run.auto, MAX_AUTO_RETRIES);
  // useAsync hides results produced for other deps, so only the shown feed's result can trigger a re-run and a
  // superseded feed never issues another worker call.
  useEffect(() => {
    if (!autoRetry) return;
    // oxlint-disable-next-line react/set-state-in-effect -- re-run an interrupted validation from its resolved result
    setStored({feedId, attempt: run.attempt + 1, auto: run.auto + 1});
  }, [autoRetry, feedId, run.attempt, run.auto]);
  return {
    status: autoRetry ? {status: 'loading'} : status,
    progress: tagged !== null && tagged.feedId === feedId ? tagged.p : null,
    retry: () => setStored({feedId, attempt: run.attempt + 1, auto: run.auto}),
  };
}
