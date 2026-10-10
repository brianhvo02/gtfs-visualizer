import {describe, expect, it} from 'vitest';
import {forgetKey, getKey, setKey} from './key-store.ts';

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

describe('key store', () => {
  it('round-trips a key under a namespaced storage key', () => {
    const storage = memoryStorage();
    setKey('511', 'abc', () => storage);
    expect(getKey('511', () => storage)).toBe('abc');
    expect(storage.getItem('gtfs-visualizer:key:511')).toBe('abc');
  });

  it('keeps providers independent', () => {
    const storage = memoryStorage();
    setKey('a', '1', () => storage);
    setKey('b', '2', () => storage);
    expect(getKey('a', () => storage)).toBe('1');
    expect(getKey('b', () => storage)).toBe('2');
  });

  it('forgets a key', () => {
    const storage = memoryStorage();
    setKey('a', '1', () => storage);
    setKey('b', '2', () => storage);
    forgetKey('a', () => storage);
    expect(getKey('a', () => storage)).toBeNull();
    expect(getKey('b', () => storage)).toBe('2');
  });

  it('trims keys and ignores empty ones', () => {
    const storage = memoryStorage();
    setKey('a', '  k  ', () => storage);
    expect(getKey('a', () => storage)).toBe('k');
    setKey('b', '   ', () => storage);
    setKey('c', '', () => storage);
    expect(getKey('b', () => storage)).toBeNull();
    expect(getKey('c', () => storage)).toBeNull();
  });

  it('survives storage being unavailable', () => {
    expect(getKey('a', throwingStorage)).toBeNull();
    expect(() => setKey('a', 'k', throwingStorage)).not.toThrow();
    expect(() => forgetKey('a', throwingStorage)).not.toThrow();
  });
});
