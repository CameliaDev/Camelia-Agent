/**
 * GitHub account helpers — profile fetch + token storage (UI-local).
 * @module
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GITHUB_TOKEN_KEY,
  clearGithubToken,
  fetchGithubProfile,
  loginWithGithubToken,
  logoutGithub,
  readGithubToken,
  writeGithubToken,
} from '../src/window/github-auth.js';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github token storage', () => {
  it('round-trips and clears the token key', () => {
    const storage = memoryStorage();
    writeGithubToken('  ghp_test  ', storage);
    expect(readGithubToken(storage)).toBe('ghp_test');
    expect(storage.getItem(GITHUB_TOKEN_KEY)).toBe('ghp_test');
    clearGithubToken(storage);
    expect(readGithubToken(storage)).toBe('');
  });
});

describe('fetchGithubProfile', () => {
  it('maps a valid payload to login/name/avatarUrl', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ login: 'octocat', name: 'The Octocat', avatar_url: 'https://avatars.example/o.png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await fetchGithubProfile('ghp_ok', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({
      ok: true,
      profile: { login: 'octocat', name: 'The Octocat', avatarUrl: 'https://avatars.example/o.png' },
    });
  });

  it('returns unauthorized / offline honestly', async () => {
    const unauthorized = vi.fn(async () => new Response('nope', { status: 401 }));
    expect(await fetchGithubProfile('bad', unauthorized as unknown as typeof fetch)).toEqual({
      ok: false,
      error: 'unauthorized',
    });

    const offline = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect(await fetchGithubProfile('x', offline as unknown as typeof fetch)).toEqual({
      ok: false,
      error: 'offline',
    });
  });
});

describe('loginWithGithubToken', () => {
  it('persists the token only on success', async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ login: 'a', avatar_url: 'https://x/a.png' }), { status: 200 }),
    );
    const ok = await loginWithGithubToken('ghp_ok', { storage, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(ok.ok).toBe(true);
    expect(readGithubToken(storage)).toBe('ghp_ok');

    const failStore = memoryStorage();
    const fail = await loginWithGithubToken('ghp_bad', {
      storage: failStore,
      fetchImpl: (async () => new Response('', { status: 403 })) as unknown as typeof fetch,
    });
    expect(fail.ok).toBe(false);
    expect(readGithubToken(failStore)).toBe('');

    logoutGithub(storage);
    expect(readGithubToken(storage)).toBe('');
  });
});
