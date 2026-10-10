import type {LightSetting} from './adapter.ts';

export const LIGHT_SETTINGS: readonly LightSetting[] = ['auto', 'dawn', 'day', 'dusk', 'night'];

const STORAGE_KEY = 'gtfs-visualizer:map-light';

export function parseLightSetting(value: string | null): LightSetting {
  return LIGHT_SETTINGS.find((setting) => setting === value) ?? 'auto';
}

function browserStorage(): Storage {
  return window.localStorage;
}

/** Storage can be missing or throw (private windows, blocked site data); the map then follows the color scheme. */
export function loadLightSetting(storage: () => Storage = browserStorage): LightSetting {
  try {
    return parseLightSetting(storage().getItem(STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function saveLightSetting(setting: LightSetting, storage: () => Storage = browserStorage): void {
  try {
    storage().setItem(STORAGE_KEY, setting);
  } catch {
    // Not persisting is fine: the choice still applies for this page view.
  }
}
