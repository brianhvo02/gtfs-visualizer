import * as Comlink from 'comlink';
import {useState} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {ValidationProgress, ValidationStatus} from '../shared/validation.ts';
import {useAsync, type AsyncState} from './use-async.ts';

/** Automatic re-runs after an interrupted (cancelled) validation, per feed. */
const MAX_AUTO_RETRIES = 2;

export interface ValidationView {
  readonly status: AsyncState<ValidationStatus>;
  /** Progress of the run for the current feed; null when unknown. */
  readonly progress: ValidationProgress | null;
  /** Runs the check again (used after an interrupted run). */
  readonly retry: () => void;
}

/** Ensures the feed's validation results are current, reporting check progress while it runs. */
export function useValidation(service: FeedApi, feedId: string | null): ValidationView {
  const [tagged, setTagged] = useState<{readonly feedId: string; readonly p: ValidationProgress} | null>(null);
  const [manual, setManual] = useState<{readonly feedId: string | null; readonly count: number}>({
    feedId,
    count: 0,
  });
  const attempt = manual.feedId === feedId ? manual.count : 0;
  const status = useAsync<ValidationStatus>(
    async () => {
      if (feedId === null) return {state: 'cancelled'};
      const onProgress = Comlink.proxy((p: ValidationProgress) => setTagged({feedId, p}));
      let result = await service.ensureValidation(feedId, onProgress);
      for (let retries = 0; result.state === 'cancelled' && retries < MAX_AUTO_RETRIES; retries++) {
        result = await service.ensureValidation(feedId, onProgress);
      }
      return result;
    },
    [service, feedId, attempt],
  );
  return {
    status,
    progress: tagged !== null && tagged.feedId === feedId ? tagged.p : null,
    retry: () => setManual({feedId, count: attempt + 1}),
  };
}
