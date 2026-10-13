/**
 * Accounts popover (VS Code–style) — account mark must not jump straight into Settings.
 */
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';

function renderApp() {
  const transport = new FixtureTransport({ scene: 'running' });
  const store = createUiStore(transport);
  const view = render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  return { ...view, store, transport };
}

describe('AccountMenu', () => {
  it('opens a popover from the account mark without opening Settings', () => {
    const { container } = renderApp();
    const account = container.querySelector('[data-rail-account]') as HTMLElement;
    expect(account).not.toBeNull();
    fireEvent.click(account);

    expect(container.querySelector('[data-account-menu]')).not.toBeNull();
    expect(container.querySelector('[data-settings-page]')).toBeNull();
    expect(account.getAttribute('aria-expanded')).toBe('true');
    expect(within(container).getByRole('menuitem', { name: '用 GitHub 登录' })).toBeInTheDocument();
    expect(within(container).getByRole('menuitem', { name: '账户设置…' })).toBeInTheDocument();
  });

  it('keeps the gear opening Settings on the default page', () => {
    const { container } = renderApp();
    fireEvent.click(container.querySelector('[data-rail-settings]') as HTMLElement);
    expect(container.querySelector('[data-settings-page]')).not.toBeNull();
    expect(container.querySelector('[data-account-menu]')).toBeNull();
    expect(within(container).getByRole('heading', { name: '连接预设' })).toBeInTheDocument();
  });

  it('opens Settings → Account from the menu item', () => {
    const { container } = renderApp();
    fireEvent.click(container.querySelector('[data-rail-account]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-account-menu-settings]') as HTMLElement);
    expect(container.querySelector('[data-account-menu]')).toBeNull();
    expect(container.querySelector('[data-settings-page]')).not.toBeNull();
    expect(container.querySelector('[data-account-section]')).not.toBeNull();
    expect(within(container).getByRole('heading', { name: '账户' })).toBeInTheDocument();
  });

  it('signs out from the menu when a GitHub profile is present', () => {
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        version: 9,
        language: 'zh',
        githubAccount: { login: 'octo', name: 'Octocat', avatarUrl: 'https://avatars.example/o.png' },
      }),
    );
    localStorage.setItem('camelia.githubToken', 'ghp_test');
    const { container } = renderApp();
    fireEvent.click(container.querySelector('[data-rail-account]') as HTMLElement);
    const menu = container.querySelector('[data-account-menu]') as HTMLElement;
    expect(menu.textContent).toContain('Octocat');
    expect(menu.textContent).toContain('@octo');
    fireEvent.click(container.querySelector('[data-account-menu-logout]') as HTMLElement);
    expect(localStorage.getItem('camelia.githubToken')).toBeNull();
  });

  it('closes on Escape', () => {
    const { container } = renderApp();
    fireEvent.click(container.querySelector('[data-rail-account]') as HTMLElement);
    expect(container.querySelector('[data-account-menu]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[data-account-menu]')).toBeNull();
  });

  it('signs in via advanced PAT paste when device flow is skipped', async () => {
    localStorage.setItem('camelia.githubOAuthClientId', 'Ov23test');
    const profile = { login: 'octo', name: 'Octocat', avatar_url: 'https://avatars.example/o.png' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/login/device/code')) {
        return new Response(JSON.stringify({ error: 'unauthorized_client' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(profile), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderApp();
    fireEvent.click(container.querySelector('[data-rail-account]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-account-menu-signin-start]') as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector('[data-account-menu-signin]')).not.toBeNull();
    });
    fireEvent.click(container.querySelector('[data-account-menu-use-pat]') as HTMLElement);
    const token = container.querySelector('[data-account-menu-token]') as HTMLInputElement;
    expect(token).not.toBeNull();
    fireEvent.change(token, { target: { value: 'ghp_abc' } });
    fireEvent.click(container.querySelector('[data-account-menu-login]') as HTMLElement);

    await waitFor(() => {
      expect(localStorage.getItem('camelia.githubToken')).toBe('ghp_abc');
    });
    vi.unstubAllGlobals();
  });
});
