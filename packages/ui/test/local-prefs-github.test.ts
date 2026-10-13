/**
 * githubAccount localPrefs persistence.
 * @module
 */
import { describe, expect, it } from 'vitest';

import { loadLocalPrefs, saveLocalPrefs, sanitizeLocalPrefs } from '../src/state/local-prefs.js';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

describe('githubAccount prefs', () => {
  it('sanitizes and persists a public GitHub profile', () => {
    const storage = memoryStorage();
    const boot = sanitizeLocalPrefs({
      githubAccount: { login: 'octo', name: 'Octo', avatarUrl: 'https://avatars.example/o.png' },
    });
    expect(boot.githubAccount).toEqual({
      login: 'octo',
      name: 'Octo',
      avatarUrl: 'https://avatars.example/o.png',
    });
    saveLocalPrefs(boot, storage);
    expect(loadLocalPrefs(storage).githubAccount?.login).toBe('octo');
    expect(sanitizeLocalPrefs({ githubAccount: { login: '', avatarUrl: '', name: '' } }).githubAccount).toBeNull();
  });
});
