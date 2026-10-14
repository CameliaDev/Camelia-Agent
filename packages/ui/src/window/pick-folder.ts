/**
 * Native folder picker, when the desktop shell provides one.
 *
 * The browser and the tests have no dialog. Callers keep a path field so the
 * working folder can still be changed by typing. Cancel stays silent; a real
 * dialog failure is reported so 「浏览」 does not look like a dead button.
 * @module
 */

export type PickFolderResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'unavailable' | 'cancelled' | 'failed'; message?: string };

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export async function pickFolder(): Promise<PickFolderResult> {
  const host = globalThis as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke } };
    __TAURI_INTERNALS__?: { invoke?: Invoke };
  };
  const invoke = host.__TAURI__?.core?.invoke ?? host.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return { ok: false, reason: 'unavailable' };
  try {
    const picked = await invoke('pick_folder');
    if (typeof picked === 'string' && picked.trim()) return { ok: true, path: picked.trim() };
    return { ok: false, reason: 'cancelled' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'failed', message };
  }
}
