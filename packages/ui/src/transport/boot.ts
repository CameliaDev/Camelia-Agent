/**
 * Boot parameters handed to the webview by the native shell.
 *
 * The shell, not the URL, is the authority on what the app should project: under the
 * Tauri asset protocol the page is served from a custom scheme where query strings are
 * an unreliable carrier of state. The shell injects `window.__CAMELIA_BOOT__` before the
 * bundle executes, which is also where the live-engine endpoint will arrive once the
 * webview is wired to a real engine (whitepaper §6.1).
 * @module
 */

export interface BootConfig {
  /** Fixture scene to project while no live engine is configured. */
  scene?: string;
  /** Live engine base URL. When present the shell prefers SSE over the fixture. */
  engineUrl?: string;
  /** Session to attach to, when resuming rather than starting fresh. */
  sessionId?: string;
}

declare global {
  interface Window {
    __CAMELIA_BOOT__?: BootConfig;
  }
}

/** Read the shell-provided boot config. Absent in a plain browser (tests, preview). */
export function readBootConfig(): BootConfig {
  if (typeof window === 'undefined') return {};
  return window.__CAMELIA_BOOT__ ?? {};
}