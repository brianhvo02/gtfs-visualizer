const PREFIX = 'gtfs-visualizer:key:';

function browserStorage(): Storage {
  return window.localStorage;
}

/** Keys live only in this browser; storage can be missing or throw, in which case there is no saved key. */
export function getKey(provider: string, storage: () => Storage = browserStorage): string | null {
  try {
    return storage().getItem(PREFIX + provider);
  } catch {
    return null;
  }
}

export function setKey(provider: string, key: string, storage: () => Storage = browserStorage): void {
  const trimmed = key.trim();
  if (trimmed === '') return;
  try {
    storage().setItem(PREFIX + provider, trimmed);
  } catch {
    // Not persisting is fine: the user can enter the key again.
  }
}

export function forgetKey(provider: string, storage: () => Storage = browserStorage): void {
  try {
    storage().removeItem(PREFIX + provider);
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}
