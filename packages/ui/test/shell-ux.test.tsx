/**
 * Shell behaviors added on top of the activity-bar collapse:
 * model picker, effort menu, gear menu, shortcuts, folder, login, plugins,
 * term timeline, math isolation and setup, settings memory.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import type { SceneId } from '../src/transport/scenario.js';

function renderScene(scene: SceneId) {
  const transport = new FixtureTransport({ scene });
  const store = createUiStore(transport);
  const view = render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  return { ...view, store, transport };
}

function openSettings(container: HTMLElement): void {
  fireEvent.click(container.querySelector('[data-rail-settings]') as HTMLElement);
  fireEvent.click(container.querySelector('[data-gear-settings]') as HTMLElement);
}

describe('composer model picker and effort', () => {
  it('opens a picker instead of Settings, including a typed model id', () => {
    const { container, transport } = renderScene('running');
    fireEvent.click(container.querySelector('[data-composer-model]') as HTMLElement);
    expect(container.querySelector('[data-settings-page]')).toBeNull();
    expect(container.querySelector('[data-model-option="deepseek-v3:free"]')).not.toBeNull();
    const input = container.querySelector('[data-model-manual-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'qwen-max' } });
    fireEvent.click(container.querySelector('[data-model-manual-use]') as HTMLElement);
    const sent = transport.sent.find((command) => command.type === 'select_provider');
    expect(sent?.payload).toMatchObject({ providerId: 'openrouter', model: 'qwen-max' });
    expect(container.querySelector('[data-composer-models]')).toBeNull();
  });

  it('lists effort levels instead of cycling on click', () => {
    const { container } = renderScene('empty');
    const effort = container.querySelector('[data-composer-effort]') as HTMLElement;
    expect(effort.getAttribute('data-effort-option')).toBe('high');
    fireEvent.click(effort);
    expect(effort.getAttribute('data-effort-option')).toBe('high');
    expect(container.querySelector('[data-effort-menu]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-effort-choice="low"]') as HTMLElement);
    expect(container.querySelector('[data-composer-effort]')?.getAttribute('data-effort-option')).toBe('low');
    expect(container.querySelector('[data-effort-menu]')).toBeNull();
  });
});

describe('gear menu and shortcuts', () => {
  it('opens themes and applies one without entering Settings', () => {
    const { container, store } = renderScene('empty');
    fireEvent.click(container.querySelector('[data-rail-settings]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-gear-themes]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-gear-theme="cool-dark"]') as HTMLElement);
    expect(store.getState().localPrefs.themeId).toBe('cool-dark');
    expect(container.querySelector('[data-settings-page]')).toBeNull();
  });

  it('toggles the session column with Ctrl+B and the drawer with Ctrl+Alt+B', () => {
    const { container } = renderScene('empty');
    const shell = container.querySelector('[data-shell]') as HTMLElement;
    const area = container.querySelector('[data-composer] textarea') as HTMLElement;
    area.focus();
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');
    fireEvent.keyDown(area, { code: 'KeyB', ctrlKey: true, key: 'b' });
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('0px');
    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true, key: 'b', repeat: true });
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('0px');
    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true, key: 'b' });
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');
    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true, altKey: true, key: 'b' });
    expect(shell.style.getPropertyValue('--rail-right-w')).not.toBe('0px');
    expect(container.querySelector('[data-panel-deck]')).not.toBeNull();
    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true, altKey: true, key: 'b' });
    expect(shell.style.getPropertyValue('--rail-right-w')).toBe('0px');
  });
});

describe('workspace folder', () => {
  it('changes the working folder from the status bar', async () => {
    const { container, store, transport } = renderScene('running');
    const task = store.getState().snapshot.task;
    fireEvent.click(container.querySelector('[data-status-item="workspace"]') as HTMLElement);
    const input = container.querySelector('[data-workspace-path]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/tmp/camelia-folder' } });
    fireEvent.click(container.querySelector('[data-workspace-apply]') as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector('[data-status-item="workspace"]')?.textContent).toContain('camelia-folder');
    });
    expect(transport.sent.some((command) => command.type === 'set_workspace')).toBe(true);
    expect(store.getState().snapshot.task).toBe(task);
  });
});

describe('first-run login', () => {
  it('shows a login page until the user skips, then stays a guest', () => {
    localStorage.removeItem('camelia.loginGate');
    const first = renderScene('empty');
    expect(first.container.querySelector('[data-login-gate]')).not.toBeNull();
    fireEvent.click(first.container.querySelector('[data-login-skip]') as HTMLElement);
    expect(first.container.querySelector('[data-login-gate]')).toBeNull();
    expect(localStorage.getItem('camelia.loginGate')).toBe('skipped');
    first.unmount();

    const second = renderScene('empty');
    expect(second.container.querySelector('[data-login-gate]')).toBeNull();
    fireEvent.click(second.container.querySelector('[data-rail-account]') as HTMLElement);
    expect(second.container.querySelector('[data-account-menu]')?.textContent).toContain('未登录');
    second.unmount();
  });
});

describe('mode isolation, math setup, and term', () => {
  it('hides the work transcript in Math and creates a session from the setup panel', async () => {
    const { container, store, transport } = renderScene('chat');
    const before = store.getState().snapshot;
    expect(container.querySelector('[data-chat-user]')).not.toBeNull();
    act(() => {
      fireEvent.click(container.querySelector('[data-mode-tab="math"]') as HTMLElement);
    });
    expect(store.getState().snapshot).toBe(before);
    expect(store.getState().lastCommand).toBeUndefined();
    expect(container.querySelector('[data-math-workspace] [data-chat-user]')).toBeNull();
    expect(container.querySelector('[data-chat-user]')).toBeNull();

    fireEvent.click(container.querySelector('[data-new-session]') as HTMLElement);
    expect(transport.sent.some((command) => command.type === 'new_session')).toBe(false);
    expect(container.querySelector('[data-math-setup]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-math-contest="mcm"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-math-setup-create]') as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector('[data-math-profile]')?.textContent).toContain('美赛');
    });
    expect(container.querySelector('[data-math-profile]')?.textContent).toContain('内置模板');
    const created = transport.sent.find((command) => command.type === 'new_session');
    expect(created?.payload).toMatchObject({ kind: 'math' });

    act(() => {
      fireEvent.click(container.querySelector('[data-mode-tab="work"]') as HTMLElement);
    });
    await waitFor(() => {
      expect(container.querySelector('[data-mode-shell="work"] [data-chat-user]')).not.toBeNull();
    });
  });

  it('runs a plan, execute, and verify pass from the term composer', async () => {
    const { container, transport } = renderScene('empty');
    fireEvent.click(container.querySelector('[data-mode-tab="term"]') as HTMLElement);
    expect(container.textContent).not.toContain('界面占位');
    expect(container.querySelector('[data-term-timeline]')).not.toBeNull();
    const area = container.querySelector('[data-composer] textarea') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'ship the notes' } });
    fireEvent.keyDown(area, { key: 'Enter' });
    await waitFor(() => {
      expect(container.querySelector('[data-term-phase="plan"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-term-run]')?.textContent).toContain('ship the notes');
    expect(transport.sent.some((command) => command.type === 'submit_task')).toBe(false);
    expect(transport.sent.some((command) => command.type === 'new_session' && (command.payload as { kind?: string }).kind === 'term')).toBe(true);
  });
});

describe('settings memory', () => {
  it('lists memories from an unscoped query', async () => {
    const { container, transport } = renderScene('running');
    openSettings(container);
    fireEvent.click(within(container).getByRole('button', { name: '记忆' }));
    await waitFor(() => {
      expect(container.querySelector('[data-settings-memory]')).not.toBeNull();
      expect(container.querySelectorAll('[data-memory-row]').length).toBeGreaterThan(0);
    });
    const listed = transport.sent.find((command) => command.type === 'list_memories');
    expect(listed?.payload).toEqual({});
  });
});
