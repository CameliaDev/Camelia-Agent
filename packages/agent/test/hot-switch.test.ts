/**
 * Model changes and last-session replacement must apply to the running runtime.
 *
 * Chat used to snapshot `decision.model` when the loop was constructed, and Settings
 * only wrote config.json — the desktop then restarted because spawn read that file
 * once. These tests pin the live path: the next chat sends the new model, a config
 * reload swaps the chain in process, and deleting a blank does not get that id back.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ChatRequest } from '@camelia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CameliaRuntime } from '../src/runtime/CameliaRuntime.js';
import type { ProviderHandle } from '../src/ProviderRegistry.js';
import { MockProvider } from '../src/providers/MockProvider.js';
import { paths } from '../src/config/paths.js';

const runtimes: CameliaRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close().catch(() => undefined)));
  vi.unstubAllEnvs();
});

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('CameliaRuntime — hot model switch', () => {
  it('sends the newly selected model on the next chat, including one that was not advertised at spawn', async () => {
    const seen: string[] = [];
    const home = tempDir('camelia-hot-home-');
    const workspace = tempDir('camelia-hot-ws-');
    vi.stubEnv('CAMELIA_HOME', home);
    const port = new MockProvider({
      id: 'mock',
      models: ['alpha', 'beta'],
      script: (request: ChatRequest) => {
        seen.push(request.model);
        return { text: 'ok' };
      },
    });
    const handle: ProviderHandle = {
      id: 'mock',
      label: 'Mock',
      model: 'alpha',
      models: ['alpha', 'beta'],
      port,
    };
    const runtime = await CameliaRuntime.create({
      workspace,
      providerHandles: [handle],
      model: 'alpha',
      databaseFile: ':memory:',
      planApproval: 'auto',
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(runtime);

    await runtime.chat(runtime.session.id, 'first', 'readonly-sandbox');
    expect(runtime.selectProvider('mock', 'beta')).toBe(true);
    await runtime.chat(runtime.session.id, 'second', 'readonly-sandbox');
    expect(runtime.selectProvider('mock', 'brand-new')).toBe(true);
    await runtime.chat(runtime.session.id, 'third', 'readonly-sandbox');

    expect(seen).toEqual(['alpha', 'beta', 'brand-new']);
    expect(runtime.modelInfo.model).toBe('brand-new');
    const saved = JSON.parse(fs.readFileSync(paths.config(), 'utf8')) as { model?: string; preferredProvider?: string };
    expect(saved.model).toBe('brand-new');
    expect(saved.preferredProvider).toBe('mock');
  });

  it('reloads providers from config.json without a new process', async () => {
    const home = tempDir('camelia-reload-home-');
    const workspace = tempDir('camelia-reload-ws-');
    vi.stubEnv('CAMELIA_HOME', home);
    const configPath = path.join(home, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        preferredProvider: 'desk',
        model: 'old-model',
        providers: [
          {
            id: 'desk',
            label: 'Desk',
            kind: 'mock',
            models: ['old-model', 'new-model'],
            defaultModel: 'old-model',
          },
        ],
      }),
    );
    const runtime = await CameliaRuntime.create({
      workspace,
      databaseFile: ':memory:',
      planApproval: 'auto',
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(runtime);
    expect(runtime.modelInfo.model).toBe('old-model');
    expect(runtime.providerChain().find((row) => row.active)?.id).toBe('desk');

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        preferredProvider: 'desk',
        model: 'new-model',
        providers: [
          {
            id: 'desk',
            label: 'Desk',
            kind: 'mock',
            models: ['old-model', 'new-model'],
            defaultModel: 'new-model',
          },
        ],
      }),
    );
    expect(runtime.applyProviderConfig({ providerId: 'desk', model: 'new-model' })).toBe(true);
    expect(runtime.modelInfo.model).toBe('new-model');
    const active = runtime.providerChain().find((row) => row.active);
    expect(active?.id).toBe('desk');
    expect(active?.models).toContain('new-model');
  });

  it('opens a different blank when the caller excludes the one being deleted', async () => {
    const home = tempDir('camelia-blank-home-');
    const workspace = tempDir('camelia-blank-ws-');
    vi.stubEnv('CAMELIA_HOME', home);
    const runtime = await CameliaRuntime.create({
      workspace,
      providerHandles: [
        {
          id: 'mock',
          label: 'Mock',
          model: 'alpha',
          models: ['alpha'],
          port: new MockProvider({ id: 'mock', models: ['alpha'], script: [{ text: 'ok' }] }),
        },
      ],
      model: 'alpha',
      databaseFile: ':memory:',
      planApproval: 'auto',
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(runtime);
    const first = await runtime.newSession('work');
    const second = await runtime.newSession('work', { excludeId: first.sessionId });
    expect(second.sessionId).not.toBe(first.sessionId);
    const third = await runtime.newSession('work');
    expect([first.sessionId, second.sessionId]).toContain(third.sessionId);
  });
});
