import * as Comlink from 'comlink';
import {useState} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {ValidationProgress, ValidationStatus} from '../shared/validation.ts';
import {useAsync, type AsyncState} from './use-async.ts';

export interface ValidationView {
  readonly status: AsyncState<ValidationStatus>;
  /** Progress of the run for the current feed; null when unknown. */
  readonly progress: ValidationProgress | null;
}

/** Ensures the feed's validation results are current, reporting check progress while it runs. */
export function useValidation(service: FeedApi, feedId: string | null): ValidationView {
  const [tagged, setTagged] = useState<{readonly feedId: string; readonly p: ValidationProgress} | null>(null);
  const status = useAsync<ValidationStatus>(
    async () =>
      feedId === null
        ? {state: 'cancelled'}
        : await service.ensureValidation(
            feedId,
            Comlink.proxy((p: ValidationProgress) => setTagged({feedId, p})),
          ),
    [service, feedId],
  );
  return {status, progress: tagged !== null && tagged.feedId === feedId ? tagged.p : null};
}
