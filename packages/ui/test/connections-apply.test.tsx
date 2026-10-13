/**
 * Saving a connection preset must reach the running engine.
 *
 * The desktop used to write config.json and then demand a full relaunch. The
 * settings card now sends `apply_provider` so the next message uses the new model.
 * @module
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConnectionsSection } from '../src/components/ConnectionsSection.js';
import { t } from '../src/i18n/strings.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';

afterEach(() => {
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  localStorage.removeItem('camelia.localPrefs');
});

describe('ConnectionsSection — apply without restart', () => {
  it('sends apply_provider when a preset is enabled, and does not offer a relaunch', async () => {
    localStorage.removeItem('camelia.localPrefs');
    const host = globalThis as unknown as {
      __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
    };
    host.__TAURI__ = {
      core: {
        invoke: async (cmd: string) => {
          if (cmd === 'read_model_settings') {
            return { preferredProvider: 'ollama', model: 'qwen2.5-coder:7b', gruntModel: '', planApproval: 'auto', providers: [] };
          }
          if (cmd === 'read_key_status') return {};
          if (cmd === 'upsert_provider_preset') return undefined;
          throw new Error(`unexpected invoke ${cmd}`);
        },
      },
    };

    const transport = new FixtureTransport({ scene: 'running' });
    const store = createUiStore(transport);
    const tr = (key: Parameters<typeof t>[1]) => t('zh', key);
    const view = render(
      <UiProvider store={store}>
        <ConnectionsSection tr={tr} />
      </UiProvider>,
    );

    await waitFor(() => {
      expect(view.container.querySelector('[data-preset-card="openrouter"]')).not.toBeNull();
    });
    const card = view.container.querySelector('[data-preset-card="openrouter"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: '启用' }));

    await waitFor(() => {
      expect(transport.sent.some((command) => command.type === 'apply_provider')).toBe(true);
    });
    const applied = transport.sent.filter((command) => command.type === 'apply_provider').at(-1);
    expect(applied?.payload).toMatchObject({
      providerId: 'openrouter',
      model: 'deepseek/deepseek-chat-v3.1:free',
    });
    expect(screen.getByText('已交给当前引擎，下一条消息会使用这个模型。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即重启' })).toBeNull();
  });
});
