/**
 * Native folder picker, when the desktop shell provides one.
 *
 * The browser and the tests have no dialog. Callers keep a path field so the
 * working folder can still be changed by typing.
 * @module
 */

export async function pickFolder(): Promise<string | null> {
  const host = globalThis as unknown as {
    __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
  };
  const invoke = host.__TAURI__?.core?.invoke;
  if (!invoke) return null;
  try {
    const picked = await invoke('pick_folder');
    return typeof picked === 'string' && picked.trim() ? picked.trim() : null;
  } catch {
    return null;
  }
}
