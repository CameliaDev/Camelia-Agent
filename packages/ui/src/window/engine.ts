/**
 * Engine diagnostics bridge for the desktop shell.
 *
 * Log open/read and relaunch go through Tauri commands. Boot trust fields
 * (engine URL, session id) come from `window.__CAMELIA_BOOT__`, which the
 * native shell injects before the bundle runs.
 * @module
 */

import { readBootConfig, type BootConfig } from '../transport/boot.js';

interface TauriCore {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> | null {
  const host = globalThis as unknown as { __TAURI__?: { core?: TauriCore } };
  const fn = host.__TAURI__?.core?.invoke;
  if (!fn) return null;
  return fn<T>(cmd, args);
}

export interface EngineTrustInfo {
  engineUrl?: string;
  sessionId?: string;
  scene?: string;
  /** True when the shell pointed the webview at a live engine. */
  expectsLiveEngine: boolean;
}

export function readEngineTrust(): EngineTrustInfo {
  const boot: BootConfig = readBootConfig();
  return {
    engineUrl: boot.engineUrl,
    sessionId: boot.sessionId,
    scene: boot.scene,
    expectsLiveEngine: Boolean(boot.engineUrl),
  };
}

/** Open `~/.camelia/logs/engine.log` in the system editor. Returns the path or an error. */
export async function openEngineLog(): Promise<{ path?: string; error?: string }> {
  const pending = invoke<string>('open_engine_log');
  if (!pending) return { error: 'desktop shell required' };
  try {
    const path = await pending;
    return { path };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Read the last N lines of the engine log (default 200). */
export async function readEngineLog(tail = 200): Promise<{ text?: string; error?: string }> {
  const pending = invoke<string>('read_engine_log', { tail });
  if (!pending) return { error: 'desktop shell required' };
  try {
    const text = await pending;
    return { text };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
