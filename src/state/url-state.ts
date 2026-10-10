import {useCallback, useMemo, useSyncExternalStore} from 'react';
import {fromIsoDate, toIsoDate} from '../gtfs/time.ts';

export interface Selection {
  readonly feed: string | null;
  readonly route: string | null;
  readonly stop: string | null;
  /** Service date as YYYYMMDD. */
  readonly date: string | null;
  /** Requested language code, as written in the URL (`original` for untranslated text). */
  readonly lang: string | null;
}

export const EMPTY_SELECTION: Selection = {feed: null, route: null, stop: null, date: null, lang: null};

const CHANGE_EVENT = 'gtfs:selectionchange';

function param(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value === null || value.length === 0 ? null : value;
}

export function parseSelection(search: string): Selection {
  const params = new URLSearchParams(search);
  const isoDate = param(params, 'date');
  return {
    feed: param(params, 'feed'),
    route: param(params, 'route'),
    stop: param(params, 'stop'),
    date: isoDate === null ? null : fromIsoDate(isoDate),
    lang: param(params, 'lang'),
  };
}

export function serializeSelection(selection: Selection): string {
  const params = new URLSearchParams();
  if (selection.feed !== null) params.set('feed', selection.feed);
  if (selection.route !== null) params.set('route', selection.route);
  if (selection.stop !== null) params.set('stop', selection.stop);
  if (selection.date !== null) params.set('date', toIsoDate(selection.date));
  if (selection.lang !== null) params.set('lang', selection.lang);
  const query = params.toString();
  return query.length === 0 ? '' : `?${query}`;
}

export function applyPatch(current: Selection, patch: Partial<Selection>): Selection {
  const switchingFeed = patch.feed !== undefined && patch.feed !== current.feed;
  const base = switchingFeed ? {...EMPTY_SELECTION, lang: current.lang} : current;
  return {...base, ...patch};
}

export type UpdateSelection = (
  patch: Partial<Selection>,
  options?: {readonly replace?: boolean},
) => void;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getSearch(): string {
  return window.location.search;
}

/** The URL query string is the source of truth for what is selected. */
export function useSelection(): [Selection, UpdateSelection] {
  const search = useSyncExternalStore(subscribe, getSearch);
  const selection = useMemo(() => parseSelection(search), [search]);
  const update = useCallback<UpdateSelection>((patch, options = {}) => {
    const next = applyPatch(parseSelection(window.location.search), patch);
    const url = `${window.location.pathname}${serializeSelection(next)}`;
    if (options.replace === true) {
      window.history.replaceState(null, '', url);
    } else {
      window.history.pushState(null, '', url);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [selection, update];
}
