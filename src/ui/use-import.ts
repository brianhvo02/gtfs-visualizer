import * as Comlink from 'comlink';
import {useCallback, useState} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import {STORAGE_HEADROOM} from '../shared/storage.ts';
import type {FeedRecord, ImportFailure, ImportProgress, ImportSource} from '../shared/types.ts';
import {formatBytes} from './format.ts';

export interface ImportController {
  readonly running: boolean;
  readonly progress: ImportProgress | null;
  readonly failure: ImportFailure | null;
  run(source: ImportSource, sizeHint: number | null): Promise<FeedRecord | null>;
}

async function requestPersistence(): Promise<void> {
  if (typeof navigator.storage?.persist !== 'function') return;
  if (await navigator.storage.persisted()) return;
  await navigator.storage.persist();
}

export function useImport(service: FeedApi): ImportController {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);

  const run = useCallback(
    async (source: ImportSource, sizeHint: number | null): Promise<FeedRecord | null> => {
      setRunning(true);
      setFailure(null);
      setProgress(null);
      const onProgress = Comlink.proxy((next: ImportProgress) => setProgress(next));
      try {
        if (sizeHint !== null) {
          const check = await service.checkStorage(sizeHint);
          if (
            !check.ok &&
            !window.confirm(
              `This feed may need about ${formatBytes(sizeHint * STORAGE_HEADROOM)} of browser storage, but only ` +
                `${formatBytes(check.availableBytes ?? 0)} is free. Import anyway?`,
            )
          ) {
            return null;
          }
        }
        const result = await service.importFeed(source, onProgress);
        if (!result.ok) {
          setFailure(result);
          return null;
        }
        void requestPersistence();
        return result.feed;
      } catch (error) {
        setFailure({
          ok: false,
          code: 'unknown',
          message: error instanceof Error ? error.message : String(error),
          issues: [],
        });
        return null;
      } finally {
        setRunning(false);
      }
    },
    [service],
  );

  return {running, progress, failure, run};
}
