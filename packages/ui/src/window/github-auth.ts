/**
 * GitHub account for the shell (avatar + display name).
 *
 * UI-first: the token never reaches the engine. We store the token in a separate
 * localStorage key and the public profile (login / name / avatarUrl) in localPrefs.
 *
 * Primary login is OAuth **device flow** (VS Code–style): show a user code, open the
 * browser, poll until GitHub grants a token. A Personal Access Token paste remains
 * as an advanced fallback when device flow is unavailable (no client_id yet, or
 * offline tooling / tests).
 *
 * Device HTTP runs through the Tauri shell when present (avoids webview CORS on
 * github.com/login/*). Tests inject `fetchImpl` / skip Tauri.
 * @module
 */

export const GITHUB_TOKEN_KEY = 'camelia.githubToken';
export const GITHUB_OAUTH_CLIENT_ID_KEY = 'camelia.githubOAuthClientId';
export const GITHUB_TOKEN_URL = 'https://github.com/settings/tokens?type=beta';
export const GITHUB_CLASSIC_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=read:user,public_repo&description=Camelia';
/** Where CameliaDev registers the desktop OAuth App (Callback URL may be http://127.0.0.1). */
export const GITHUB_OAUTH_APP_NEW_URL = 'https://github.com/settings/applications/new';

/**
 * Public OAuth App client_id. Device flow does not use a client secret.
 * Resolution: Vite env → localStorage override → baked constant (may be empty until
 * CameliaDev registers the app and commits / sets VITE_GITHUB_OAUTH_CLIENT_ID).
 */
const BAKED_GITHUB_OAUTH_CLIENT_ID = '';

export const GITHUB_DEVICE_SCOPE = 'read:user public_repo';

export interface GithubProfile {
  login: string;
  name: string;
  avatarUrl: string;
}

export type GithubLoginResult =
  | { ok: true; profile: GithubProfile }
  | { ok: false; error: string };

export interface GithubDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type GithubDevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'authorized'; accessToken: string }
  | { status: 'error'; error: string };

function storageOf(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage;
}

function viteClientId(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const v = env?.VITE_GITHUB_OAUTH_CLIENT_ID?.trim();
    return v || '';
  } catch {
    return '';
  }
}

export function readGithubOAuthClientId(storage?: Storage): string {
  const fromEnv = viteClientId();
  if (fromEnv) return fromEnv;
  const bin = storageOf(storage);
  if (bin) {
    try {
      const stored = bin.getItem(GITHUB_OAUTH_CLIENT_ID_KEY)?.trim() ?? '';
      if (stored) return stored;
    } catch {
      /* ignore */
    }
  }
  return BAKED_GITHUB_OAUTH_CLIENT_ID.trim();
}

export function writeGithubOAuthClientId(clientId: string, storage?: Storage): void {
  const bin = storageOf(storage);
  if (!bin) return;
  const value = clientId.trim();
  if (!value) {
    bin.removeItem(GITHUB_OAUTH_CLIENT_ID_KEY);
    return;
  }
  bin.setItem(GITHUB_OAUTH_CLIENT_ID_KEY, value);
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

function tauriInvoke():
  | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
  | undefined {
  const host = globalThis as unknown as {
    __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
  };
  return host.__TAURI__?.core?.invoke;
}

/**
 * Open a URL in the system browser when the desktop shell is available;
 * fall back to `window.open` (browser / tests).
 */
export async function openExternalUrl(url: string): Promise<string | null> {
  const invoke = tauriInvoke();
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
export async function fetchGithubProfile(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubLoginResult> {
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

async function postForm(
  url: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const form = new URLSearchParams(body).toString();
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { ok: res.ok, status: res.status, json };
}

async function deviceCodeViaTauri(clientId: string, scope: string): Promise<GithubDeviceCode | { error: string }> {
  const invoke = tauriInvoke();
  if (!invoke) return { error: 'no-tauri' };
  try {
    const raw = (await invoke('github_device_code', { clientId, scope })) as Record<string, unknown>;
    if (typeof raw?.error === 'string' && raw.error) return { error: String(raw.error) };
    const deviceCode = String(raw.device_code ?? '');
    const userCode = String(raw.user_code ?? '');
    const verificationUri = String(raw.verification_uri ?? 'https://github.com/login/device');
    const expiresIn = Number(raw.expires_in ?? 900);
    const interval = Number(raw.interval ?? 5);
    if (!deviceCode || !userCode) return { error: 'malformed' };
    return { deviceCode, userCode, verificationUri, expiresIn, interval };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function devicePollViaTauri(
  clientId: string,
  deviceCode: string,
): Promise<GithubDevicePollResult> {
  const invoke = tauriInvoke();
  if (!invoke) return { status: 'error', error: 'no-tauri' };
  try {
    const raw = (await invoke('github_device_poll', { clientId, deviceCode })) as Record<string, unknown>;
    const err = typeof raw.error === 'string' ? raw.error : '';
    if (err === 'authorization_pending') return { status: 'pending' };
    if (err === 'slow_down') {
      return { status: 'slow_down', interval: Number(raw.interval ?? 10) };
    }
    if (err === 'expired_token') return { status: 'error', error: 'expired' };
    if (err === 'access_denied') return { status: 'error', error: 'denied' };
    if (err) return { status: 'error', error: err };
    const accessToken = String(raw.access_token ?? '');
    if (!accessToken) return { status: 'error', error: 'malformed' };
    return { status: 'authorized', accessToken };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Start GitHub device authorization. Returns the user-facing code to display.
 */
export async function startGithubDeviceFlow(options?: {
  clientId?: string;
  storage?: Storage;
  fetchImpl?: typeof fetch;
  scope?: string;
}): Promise<{ ok: true; device: GithubDeviceCode } | { ok: false; error: string }> {
  const clientId = (options?.clientId ?? readGithubOAuthClientId(options?.storage)).trim();
  if (!clientId) return { ok: false, error: 'missing-client-id' };
  const scope = options?.scope ?? GITHUB_DEVICE_SCOPE;
  const fetchImpl = options?.fetchImpl ?? fetch;

  const viaTauri = await deviceCodeViaTauri(clientId, scope);
  if (!('error' in viaTauri)) {
    return { ok: true, device: viaTauri };
  }
  if (viaTauri.error !== 'no-tauri') {
    return { ok: false, error: viaTauri.error || 'device-start-failed' };
  }

  try {
    const { ok, json } = await postForm(
      'https://github.com/login/device/code',
      { client_id: clientId, scope },
      fetchImpl,
    );
    if (typeof json.error === 'string') {
      return { ok: false, error: String(json.error) };
    }
    if (!ok) return { ok: false, error: 'device-start-failed' };
    const deviceCode = typeof json.device_code === 'string' ? json.device_code : '';
    const userCode = typeof json.user_code === 'string' ? json.user_code : '';
    const verificationUri =
      typeof json.verification_uri === 'string' ? json.verification_uri : 'https://github.com/login/device';
    if (!deviceCode || !userCode) return { ok: false, error: 'malformed' };
    return {
      ok: true,
      device: {
        deviceCode,
        userCode,
        verificationUri,
        expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 900,
        interval: typeof json.interval === 'number' ? json.interval : 5,
      },
    };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

/** One poll tick of the device-flow token endpoint. */
export async function pollGithubDeviceFlow(
  deviceCode: string,
  options?: { clientId?: string; storage?: Storage; fetchImpl?: typeof fetch },
): Promise<GithubDevicePollResult> {
  const clientId = (options?.clientId ?? readGithubOAuthClientId(options?.storage)).trim();
  if (!clientId) return { status: 'error', error: 'missing-client-id' };
  const fetchImpl = options?.fetchImpl ?? fetch;

  const viaTauri = await devicePollViaTauri(clientId, deviceCode);
  if (!(viaTauri.status === 'error' && viaTauri.error === 'no-tauri')) {
    return viaTauri;
  }

  try {
    const { json } = await postForm(
      'https://github.com/login/oauth/access_token',
      {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      fetchImpl,
    );
    const err = typeof json.error === 'string' ? json.error : '';
    if (err === 'authorization_pending') return { status: 'pending' };
    if (err === 'slow_down') {
      return { status: 'slow_down', interval: typeof json.interval === 'number' ? json.interval : 10 };
    }
    if (err === 'expired_token') return { status: 'error', error: 'expired' };
    if (err === 'access_denied') return { status: 'error', error: 'denied' };
    if (err) return { status: 'error', error: err };
    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    if (!accessToken) return { status: 'error', error: 'malformed' };
    return { status: 'authorized', accessToken };
  } catch {
    return { status: 'error', error: 'offline' };
  }
}

export type DeviceFlowLoginResult =
  | { ok: true; profile: GithubProfile }
  | { ok: false; error: string; cancelled?: boolean };

/**
 * Run device flow to completion: poll until authorized / error / abort.
 * Opens the verification URL when `openBrowser` is true (default).
 */
export async function loginWithGithubDeviceFlow(options?: {
  clientId?: string;
  storage?: Storage;
  fetchImpl?: typeof fetch;
  openBrowser?: boolean;
  signal?: AbortSignal;
  onUserCode?: (device: GithubDeviceCode) => void;
}): Promise<DeviceFlowLoginResult> {
  const started = await startGithubDeviceFlow(options);
  if (!started.ok) return { ok: false, error: started.error };
  options?.onUserCode?.(started.device);

  if (options?.openBrowser !== false) {
    await openExternalUrl(started.device.verificationUri);
  }

  let intervalMs = Math.max(5, started.device.interval) * 1000;
  const deadline = Date.now() + started.device.expiresIn * 1000;

  while (Date.now() < deadline) {
    if (options?.signal?.aborted) {
      return { ok: false, error: 'cancelled', cancelled: true };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    if (options?.signal?.aborted) {
      return { ok: false, error: 'cancelled', cancelled: true };
    }
    const tick = await pollGithubDeviceFlow(started.device.deviceCode, options);
    if (tick.status === 'pending') continue;
    if (tick.status === 'slow_down') {
      intervalMs = Math.max(intervalMs, tick.interval * 1000);
      continue;
    }
    if (tick.status === 'error') {
      return { ok: false, error: tick.error };
    }
    const profile = await fetchGithubProfile(tick.accessToken, options?.fetchImpl);
    if (!profile.ok) return profile;
    writeGithubToken(tick.accessToken, options?.storage);
    return { ok: true, profile: profile.profile };
  }
  return { ok: false, error: 'expired' };
}
