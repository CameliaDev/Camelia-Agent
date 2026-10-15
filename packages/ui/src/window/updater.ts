/**
 * In-app updates — the shell's `updater` module, reached over Tauri invoke.
 *
 * The flow the product wants: a new version is noticed inside the app, downloaded,
 * checksum-verified, swapped in, and the app restarts itself — no installer wizard,
 * no browser detour. The Rust side (`apps/desktop/src-tauri/src/updater.rs`) owns the
 * feed allowlist, the sha256 check and the swap script; this module is only the
 * typed bridge plus the "are we even in the shell" question.
 *
 * Outside the desktop shell (browser dev, fixture tests) every call degrades to a
 * no-op answer, so callers never branch on the environment.
 * @module
 */

interface TauriCore {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauriInvoke(): TauriCore['invoke'] {
  const host = globalThis as unknown as { __TAURI__?: { core?: TauriCore } };
  return host.__TAURI__?.core?.invoke;
}

/** True when running inside the Tauri desktop shell (update commands exist). */
export function inDesktopShell(): boolean {
  return typeof tauriInvoke() === 'function';
}

/** The shell's own version — what the feed's `version` is compared against. */
export async function currentVersion(): Promise<string> {
  const invoke = tauriInvoke();
  if (!invoke) return '';
  const value = (await invoke('current_version')) as string;
  return typeof value === 'string' ? value : '';
}

/** The configured update feed (or the built-in default). */
export async function updateFeedUrl(): Promise<string> {
  const invoke = tauriInvoke();
  if (!invoke) return '';
  const value = (await invoke('update_feed_url')) as string;
  return typeof value === 'string' ? value : '';
}

/** Repoint the update feed. Allowlist-checked on the Rust side. */
export async function setUpdateFeed(url: string): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke('set_update_feed', { url });
}

/** An offered update, as the feed describes it. */
export interface UpdateOffer {
  version: string;
  notes: string;
  url: string;
  sha256: string;
}

/**
 * Ask the feed whether a newer version exists.
 *
 * `null` means "no offer" — up to date, feed unreachable, feed malformed. The Rust
 * side deliberately folds all three into one answer so a broken feed never turns
 * into an error dialog on boot.
 */
export async function checkUpdate(): Promise<UpdateOffer | null> {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  const value = (await invoke('check_update')) as UpdateOffer | null;
  if (!value || typeof value.version !== 'string' || typeof value.url !== 'string') return null;
  return {
    version: value.version,
    notes: typeof value.notes === 'string' ? value.notes : '',
    url: value.url,
    sha256: typeof value.sha256 === 'string' ? value.sha256 : '',
  };
}

/**
 * Download, verify, swap and restart.
 *
 * Returns only on failure: on success the process exits while the swap script
 * finishes the replacement. Callers should treat a resolved promise as "update
 * failed, nothing changed".
 */
export async function applyUpdate(offer: UpdateOffer): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error('not running inside the desktop shell');
  await invoke('apply_update', {
    version: offer.version,
    url: offer.url,
    sha256: offer.sha256,
  });
}
