import {useEffect, useState, type DependencyList} from 'react';

export type AsyncState<T> =
  | {readonly status: 'loading'}
  | {readonly status: 'ok'; readonly value: T}
  | {readonly status: 'error'; readonly error: unknown};

export function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
}

interface Tagged<T> {
  readonly deps: DependencyList;
  readonly state: AsyncState<T>;
}

/** Runs `load` whenever `deps` change, ignoring results from superseded runs. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [stored, setStored] = useState<Tagged<T>>({deps, state: {status: 'loading'}});
  // `load` is recreated every render; callers list its inputs in `deps`.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setStored({deps, state: {status: 'loading'}});
    load().then(
      (value) => {
        if (!cancelled) setStored({deps, state: {status: 'ok', value}});
      },
      (error: unknown) => {
        if (!cancelled) setStored({deps, state: {status: 'error', error}});
      },
    );
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  // Never expose a result produced for different deps (stale until the effect runs).
  return sameDeps(stored.deps, deps) ? stored.state : {status: 'loading'};
}
