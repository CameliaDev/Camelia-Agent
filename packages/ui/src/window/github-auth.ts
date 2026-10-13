/**
 * GitHub account for the shell (avatar + display name).
 *
 * UI-first: the token never reaches the engine. We store the token in a separate
 * localStorage key and the public profile (login / name / avatarUrl) in localPrefs.
 *
 * Login is a Personal Access Token paste: no OAuth App client_id ships with the
 * binary yet, so device-flow would fail honestly. The UI opens GitHub's token
 * page in the browser and fetches `GET /user` with the pasted token.
 * @module
 */

export const GITHUB_TOKEN_KEY = 'camelia.githubToken';
export const GITHUB_TOKEN_URL = 'https://github.com/settings/tokens?type=beta';
export const GITHUB_CLASSIC_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=read:user&description=Camelia';

export interface GithubProfile {
  login: string;
  name: string;
  avatarUrl: string;
}

export type GithubLoginResult =
  | { ok: true; profile: GithubProfile }
  | { ok: false; error: string };

function storageOf(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage;
}

export function readGithubToken(storage?: Storage): string {
  const bin = storageOf(storage);
  if (!bin) return '';
  try {
    return bin.getItem(GITHUB_TOKEN_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function writeGithubToken(token: string, storage?: Storage): void {
  const bin = storageOf(storage);
  if (!bin) return;
  const value = token.trim();
  if (!value) {
    bin.removeItem(GITHUB_TOKEN_KEY);
    return;
  }
  bin.setItem(GITHUB_TOKEN_KEY, value);
}

export function clearGithubToken(storage?: Storage): void {
  writeGithubToken('', storage);
}

/**
 * Open a URL in the system browser when the desktop shell is available;
 * fall back to `window.open` (browser / tests).
 */
export async function openExternalUrl(url: string): Promise<string | null> {
  const host = globalThis as unknown as {
    __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
  };
  const invoke = host.__TAURI__?.core?.invoke;
  if (invoke) {
    try {
      await invoke('open_external_url', { url });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Exchange a PAT for the public GitHub profile. Never invents a success.
 */
export async function fetchGithubProfile(token: string, fetchImpl: typeof fetch = fetch): Promise<GithubLoginResult> {
  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, error: 'empty-token' };
  }
  try {
    const res = await fetchImpl('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${trimmed}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'unauthorized' };
    }
    if (!res.ok) {
      return { ok: false, error: `http-${res.status}` };
    }
    const body = (await res.json()) as { login?: unknown; name?: unknown; avatar_url?: unknown };
    const login = typeof body.login === 'string' ? body.login.trim() : '';
    const avatarUrl = typeof body.avatar_url === 'string' ? body.avatar_url.trim() : '';
    if (!login || !avatarUrl) {
      return { ok: false, error: 'malformed' };
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : login;
    return { ok: true, profile: { login, name, avatarUrl } };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

export async function loginWithGithubToken(
  token: string,
  options?: { storage?: Storage; fetchImpl?: typeof fetch },
): Promise<GithubLoginResult> {
  const result = await fetchGithubProfile(token, options?.fetchImpl);
  if (!result.ok) return result;
  writeGithubToken(token, options?.storage);
  return result;
}

export function logoutGithub(storage?: Storage): void {
  clearGithubToken(storage);
}
