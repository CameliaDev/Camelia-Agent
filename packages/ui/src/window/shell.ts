/**
 * Desktop window bridge.
 *
 * Uses the Tauri global injected by `withGlobalTauri`. The UI package does not
 * depend on `@tauri-apps/api`. In a browser or in Vitest the bridge is a no-op.
 * @module
 */

import { loadLocalPrefs, type WindowGeometry } from '../state/local-prefs.js';

interface LogicalPoint {
  x: number;
  y: number;
  type: 'Logical';
}

interface TauriWindow {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  show: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  startResizeDragging: (direction: string) => Promise<void>;
  outerPosition: () => Promise<{ x: number; y: number }>;
  innerSize: () => Promise<{ width: number; height: number }>;
  setPosition: (pos: LogicalPoint) => Promise<void>;
  setSize: (size: LogicalPoint) => Promise<void>;
  maximize: () => Promise<void>;
}

function currentWindow(): TauriWindow | null {
  const host = globalThis as unknown as {
    __TAURI__?: { window?: { getCurrentWindow?: () => TauriWindow } };
  };
  const factory = host.__TAURI__?.window?.getCurrentWindow;
  if (!factory) return null;
  try {
    return factory();
  } catch {
    return null;
  }
}

export function isTauri(): boolean {
  return currentWindow() !== null;
}

export async function windowMinimize(): Promise<void> {
  await currentWindow()?.minimize();
}

export async function windowToggleMaximize(): Promise<void> {
  await currentWindow()?.toggleMaximize();
}

export async function windowClose(): Promise<void> {
  await currentWindow()?.close();
}

export async function windowStartResize(direction: string): Promise<void> {
  await currentWindow()?.startResizeDragging(direction);
}

export async function readWindowGeometry(): Promise<WindowGeometry | null> {
  const win = currentWindow();
  if (!win) return null;
  try {
    const [pos, size, maximized] = await Promise.all([win.outerPosition(), win.innerSize(), win.isMaximized()]);
    return {
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      maximized,
    };
  } catch {
    return null;
  }
}

/** Apply a saved frame, then show the window. Safe to call when Tauri is absent. */
export async function revealWindow(): Promise<void> {
  const win = currentWindow();
  if (!win) return;
  const saved = loadLocalPrefs().window;
  try {
    if (saved?.maximized) {
      await win.maximize();
    } else if (saved) {
      await win.setSize({ type: 'Logical', x: saved.width, y: saved.height });
      await win.setPosition({ type: 'Logical', x: saved.x, y: saved.y });
    }
  } catch {
    // A bad frame must not keep the window hidden.
  }
  try {
    await win.show();
  } catch {
    /* already visible */
  }
}

/** Persist geometry while the window is open. No-op outside Tauri. */
export function watchWindowGeometry(onGeometry: (geometry: WindowGeometry) => void): () => void {
  const win = currentWindow();
  if (!win) return () => undefined;
  let last = '';
  const tick = (): void => {
    void readWindowGeometry().then((geometry) => {
      if (!geometry) return;
      const key = JSON.stringify(geometry);
      if (key === last) return;
      last = key;
      onGeometry(geometry);
    });
  };
  const timer = setInterval(tick, 1500);
  window.addEventListener('beforeunload', tick);
  return () => {
    clearInterval(timer);
    window.removeEventListener('beforeunload', tick);
  };
}
