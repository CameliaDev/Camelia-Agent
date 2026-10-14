/**
 * Vitest setup for the UI package.
 *
 * Only two things are stubbed: `matchMedia` (jsdom lacks it, and the theme reads it) and
 * `ResizeObserver` (used by scroll containers). Everything else — including the event
 * projection — runs for real, because the projection is the thing under test.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

import { clearThemeTokens } from '../src/theme/apply-theme.js';
import { resetShellExtras } from '../src/state/shell-extras.js';

beforeEach(() => {
  localStorage.clear();
  // Tests are returning guests. A first-run case removes this key itself.
  localStorage.setItem('camelia.loginGate', 'skipped');
  resetShellExtras();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetShellExtras();
  clearThemeTokens();
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.resizing;
});

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.resolve() },
    configurable: true,
  });
}