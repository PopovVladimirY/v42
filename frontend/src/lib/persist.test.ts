import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadJSON, saveJSON } from './persist';

describe('persist', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips an object through save then load', () => {
    saveJSON('k', { a: 1, b: 'two' });
    expect(loadJSON<{ a: number; b: string }>('k')).toEqual({ a: 1, b: 'two' });
  });

  it('returns null for a missing key', () => {
    expect(loadJSON('nope')).toBeNull();
  });

  it('returns null for corrupt JSON instead of throwing', () => {
    localStorage.setItem('bad', '{not json');
    expect(() => loadJSON('bad')).not.toThrow();
    expect(loadJSON('bad')).toBeNull();
  });

  it('round-trips arrays', () => {
    saveJSON('list', [1, 2, 3]);
    expect(loadJSON<number[]>('list')).toEqual([1, 2, 3]);
  });

  it('swallows setItem failures (quota / private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveJSON('k', { big: 'data' })).not.toThrow();
  });

  it('swallows getItem failures', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(loadJSON('k')).toBeNull();
  });
});
