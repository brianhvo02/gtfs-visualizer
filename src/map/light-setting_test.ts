import {describe, expect, it} from 'vitest';
import {loadLightSetting, parseLightSetting, saveLightSetting} from './light-setting.ts';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function throwingStorage(): Storage {
  throw new DOMException('blocked', 'SecurityError');
}

describe('parseLightSetting', () => {
  it('accepts every preset and auto', () => {
    for (const value of ['auto', 'dawn', 'day', 'dusk', 'night']) {
      expect(parseLightSetting(value)).toBe(value);
    }
  });

  it('falls back to auto for missing or unknown values', () => {
    expect(parseLightSetting(null)).toBe('auto');
    expect(parseLightSetting('noon')).toBe('auto');
  });
});

describe('loadLightSetting / saveLightSetting', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    saveLightSetting('dusk', () => storage);
    expect(loadLightSetting(() => storage)).toBe('dusk');
  });

  it('ignores a corrupted stored value', () => {
    const storage = memoryStorage({'gtfs-visualizer:map-light': 'sunset'});
    expect(loadLightSetting(() => storage)).toBe('auto');
  });

  it('survives storage being unavailable', () => {
    expect(loadLightSetting(throwingStorage)).toBe('auto');
    expect(() => saveLightSetting('night', throwingStorage)).not.toThrow();
  });
});
