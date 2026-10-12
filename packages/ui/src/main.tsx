/**
 * Webview entry point.
 *
 * The scene and replay mode come from the query string so a screenshot harness can ask
 * for a specific, reproducible UI state (`?scene=approval`) without touching code.
 * @module
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from './App.js';
import { IconSheet } from './components/IconSheet.js';
import { createUiStore } from './state/store.js';
import { UiProvider } from './state/UiProvider.js';
import { createTransport } from './transport/index.js';
import { readBootConfig } from './transport/boot.js';
import { applySceneBoot } from './modes/math/demoBoot.js';
import { revealWindow, watchWindowGeometry } from './window/shell.js';

const transport = createTransport(window.location.search);
const store = createUiStore(transport);
const sheet = new URLSearchParams(window.location.search).get('sheet');

// Scene-specific chrome (e.g. the labelled math demo) is applied *outside* the event
// stream, so a demonstration scene can never be mistaken for projected engine state.
const shellBoot = readBootConfig();
applySceneBoot(store, shellBoot.scene ?? new URLSearchParams(window.location.search).get('scene'));

async function boot(): Promise<void> {
  await Promise.race([revealWindow(), new Promise((resolve) => setTimeout(resolve, 800))]);
  const container = document.getElementById('root');
  if (!container) return;
  createRoot(container).render(
    <StrictMode>
      <UiProvider store={store}>
        {sheet === 'icons' ? <IconSheet /> : <App />}
      </UiProvider>
    </StrictMode>,
  );
  watchWindowGeometry((geometry) => {
    const current = store.getState().localPrefs.window;
    if (current && JSON.stringify(current) === JSON.stringify(geometry)) return;
    store.getState().setLocalPrefs({ window: geometry });
  });
}

void boot();