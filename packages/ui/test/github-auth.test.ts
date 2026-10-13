/**
 * GitHub account helpers — profile fetch, token storage, device flow (UI-local).
 * @module
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GITHUB_TOKEN_KEY,
  clearGithubToken,
  fetchGithubProfile,
  loginWithGithubDeviceFlow,
  loginWithGithubToken,
  logoutGithub,
  pollGithubDeviceFlow,
  readGithubOAuthClientId,
  readGithubToken,
  startGithubDeviceFlow,
  writeGithubOAuthClientId,
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

describe('github device flow', () => {
  it('refuses to start without a client id', async () => {
    const storage = memoryStorage();
    const started = await startGithubDeviceFlow({ storage, clientId: '' });
    expect(started).toEqual({ ok: false, error: 'missing-client-id' });
  });

  it('stores a client id override and completes a mocked device login', async () => {
    const storage = memoryStorage();
    writeGithubOAuthClientId('Ov23testclient', storage);
    expect(readGithubOAuthClientId(storage)).toBe('Ov23testclient');

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/login/device/code')) {
        return new Response(
          JSON.stringify({
            device_code: 'dc_1',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/login/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'gho_device' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('api.github.com/user')) {
        return new Response(JSON.stringify({ login: 'dev', name: 'Dev', avatar_url: 'https://x/d.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('nope', { status: 404 });
    });

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const seen: string[] = [];
    vi.useFakeTimers();
    const pending = loginWithGithubDeviceFlow({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUserCode: (d) => seen.push(d.userCode),
    });
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(seen).toEqual(['ABCD-1234']);
    expect(result).toEqual({
      ok: true,
      profile: { login: 'dev', name: 'Dev', avatarUrl: 'https://x/d.png' },
    });
    expect(readGithubToken(storage)).toBe('gho_device');
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();

    const pollPending = await pollGithubDeviceFlow('dc_1', {
      storage,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: 'authorization_pending' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    expect(pollPending).toEqual({ status: 'pending' });
  });
});
