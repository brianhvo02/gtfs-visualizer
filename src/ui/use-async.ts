import {useEffect, useState, type DependencyList} from 'react';

export type AsyncState<T> =
  | {readonly status: 'loading'}
  | {readonly status: 'ok'; readonly value: T}
  | {readonly status: 'error'; readonly error: unknown};

/** Runs `load` whenever `deps` change, ignoring results from superseded runs. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({status: 'loading'});
  // `load` is recreated every render; callers list its inputs in `deps`.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setState({status: 'loading'});
    load().then(
      (value) => {
        if (!cancelled) setState({status: 'ok', value});
      },
      (error: unknown) => {
        if (!cancelled) setState({status: 'error', error});
      },
    );
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
