/**
 * Test helpers — install the math-mode shell plugin in the fixture transport.
 * @module
 */

import { act, fireEvent } from '@testing-library/react';

import { makeCommand } from '../src/state/store.js';
import type { UiStore } from '../src/state/store.js';

export async function installMathPlugin(store: UiStore): Promise<void> {
  await act(async () => {
    await store.getState().query(makeCommand('install_catalog_plugin', { id: 'math-mode' }));
    await store.getState().refreshInstalledPlugins();
  });
}

export function mathRailButton(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-rail-view="math"]');
  if (!el) throw new Error('math activity-bar icon not found — call installMathPlugin first');
  return el as HTMLElement;
}

export async function enterMathMode(container: HTMLElement, store: UiStore): Promise<void> {
  await installMathPlugin(store);
  await act(async () => {
    fireEvent.click(mathRailButton(container));
  });
}
