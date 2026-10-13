/**
 * Desktop shell trust chrome: connection panel + offline banner.
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import type { SceneId } from '../src/transport/scenario.js';

function renderScene(scene: SceneId): ReturnType<typeof createUiStore> {
  const transport = new FixtureTransport({ scene, replay: 'instant' });
  const store = createUiStore(transport);
  render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  return store;
}

afterEach(() => {
  cleanup();
  delete window.__CAMELIA_BOOT__;
});

describe('desktop shell connection chrome', () => {
  it('opens engine connection details from the status bar, not the top bar', () => {
    renderScene('empty');
    expect(document.querySelector('.camelia-topbar [data-connection-status]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Offline' }));
    expect(document.querySelector('[data-settings-page]')).not.toBeNull();
    expect(document.querySelector('[data-engine-section]')).not.toBeNull();
    expect(document.querySelector('[data-engine-connection]')).toHaveAttribute('data-engine-connection', 'offline');
    expect(document.querySelector('[data-engine-connection]')?.textContent).toBe('Offline');
    expect(screen.getByText(/演示模式/)).toBeInTheDocument();
  });

  it('shows a disconnect banner only when a live engine was expected', () => {
    window.__CAMELIA_BOOT__ = { engineUrl: 'http://127.0.0.1:7433', sessionId: 'ses_test' };
    // Fixture still runs (no SSE in jsdom); force offline after boot.
    const store = renderScene('empty');
    act(() => {
      store.setState({ status: 'offline' });
    });
    expect(screen.getByText('引擎已断开')).toBeInTheDocument();
    expect(screen.getByText(/等待本机引擎/)).toBeInTheDocument();
  });

  it('keeps the banner hidden for fixture offline', () => {
    renderScene('empty');
    expect(screen.queryByText('引擎已断开')).not.toBeInTheDocument();
  });
});
