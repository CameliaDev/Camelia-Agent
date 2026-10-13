/**
 * In-app update check against GitHub Releases.
 *
 * This is not `tauri-plugin-updater`. That path needs a minisign key, a
 * `latest.json` endpoint, and a signed NSIS asset before a silent swap is safe.
 * Until those exist, Settings asks `GET /repos/CameliaDev/Camelia-Agent/releases/latest`,
 * shows the notes, and — on the Windows desktop — downloads the `*-setup.exe`
 * and starts it. The installer is still the current-user NSIS overwrite build
 * (`installMode: currentUser` in `tauri.conf.json`). Nothing here changes that
 * package.
 *
 * Still required before unattended updates:
 * - a GitHub Release whose asset is `Camelia_<version>_x64-setup.exe`
 * - a Tauri updater private key, and the matching public key in the bundle
 * - `latest.json` (or the updater's GitHub endpoint) with the signature
 * @module
 */

export const UPDATES_REPO = 'CameliaDev/Camelia-Agent';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${UPDATES_REPO}/releases/latest`;

export interface ReleaseAsset {
  name: string;
  browserDownloadUrl: string;
  size: number;
}

export interface UpdateOffer {
  current: string;
  latest: string;
  updateAvailable: boolean;
  notes: string;
  htmlUrl: string;
  asset: ReleaseAsset | null;
  publishedAt: string | null;
}

/** Compare dotted numeric versions. Leading `v` is ignored. Non-numeric tails are dropped. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((part) => {
        const match = /^(\d+)/.exec(part);
        return match ? Number(match[1]) : 0;
      });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Prefer the NSIS setup exe this repo already ships. Skip blockmaps and signatures. */
export function pickInstallerAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  const exes = assets.filter((asset) => /\.exe$/i.test(asset.name) && !/\.blockmap$/i.test(asset.name));
  return exes.find((asset) => /setup\.exe$/i.test(asset.name)) ?? exes[0] ?? null;
}

export function interpretRelease(current: string, payload: unknown): UpdateOffer {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const tag = typeof body.tag_name === 'string' ? body.tag_name : typeof body.name === 'string' ? body.name : '';
  const latest = tag.replace(/^v/i, '') || current;
  const rawAssets = Array.isArray(body.assets) ? body.assets : [];
  const assets: ReleaseAsset[] = [];
  for (const item of rawAssets) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : '';
    const browserDownloadUrl = typeof row.browser_download_url === 'string' ? row.browser_download_url : '';
    if (!name || !browserDownloadUrl.startsWith('https://')) continue;
    assets.push({
      name,
      browserDownloadUrl,
      size: typeof row.size === 'number' ? row.size : 0,
    });
  }
  return {
    current,
    latest,
    updateAvailable: compareVersions(latest, current) > 0,
    notes: typeof body.body === 'string' ? body.body.trim() : '',
    htmlUrl: typeof body.html_url === 'string' ? body.html_url : `https://github.com/${UPDATES_REPO}/releases`,
    asset: pickInstallerAsset(assets),
    publishedAt: typeof body.published_at === 'string' ? body.published_at : null,
  };
}

export async function checkForUpdate(current: string, fetchImpl: typeof fetch = fetch): Promise<UpdateOffer> {
  const response = await fetchImpl(LATEST_RELEASE_URL, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`GitHub releases answered ${response.status}`);
  }
  return interpretRelease(current, await response.json());
}

interface TauriCore {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> | null {
  const host = globalThis as unknown as { __TAURI__?: { core?: TauriCore } };
  const fn = host.__TAURI__?.core?.invoke;
  if (!fn) return null;
  return fn<T>(cmd, args);
}

/** Start the downloaded NSIS installer. Returns an error string, or null on success. */
export async function launchInstaller(url: string): Promise<string | null> {
  const pending = invoke<string>('download_update', { url });
  if (!pending) return 'desktop shell required';
  try {
    await pending;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
