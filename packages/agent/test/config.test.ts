/**
 * Configuration resolution and the Camelia home layout (whitepaper §3.8, §5.3).
 *
 * Precedence is a security property here: keys may come from the environment or
 * `~/.camelia/keys.json`, never from the repository.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultProfiles, loadConfig, usableProfiles, type CameliaConfig } from '../src/config/load.js';
import { cameliaHome, ensureCameliaHome, paths } from '../src/config/paths.js';

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-home-'));
  vi.stubEnv('CAMELIA_HOME', dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('defaultProfiles', () => {
  it('ships the three free paths in fallback order', () => {
    expect(defaultProfiles().map((p) => p.id)).toEqual(['opencode-zen', 'openrouter', 'ollama']);
  });

  it('marks every default path as tool-capable', () => {
    // 所有内置 provider 都必须声明 supportsTools: true。
    //
    // 原因：`ModelGateway` 在能力为 false 时会**静默剥离**工具列表
    // （`toolsSuppressed`）。模型收到任务却没有任何工具可用，只能输出文本，
    // 任务永远完不成且不报错。这条断言就是那个缺陷的回归护栏 ——
    // 它曾经是 `false`，被当作「保守估计」，实际会让本地路径完全无法执行任务。
    for (const profile of defaultProfiles()) {
      expect(profile.capabilities?.supportsTools, `${profile.id} 必须声明支持工具调用`).toBe(true);
    }
  });

  it('keeps the local context window small enough for a 6GB GPU', () => {
    // 6GB 显存的笔记本上，32k 上下文会把 KV cache 挤出显存，Ollama 回退到
    // 系统内存后延迟高一个数量级。宁可上下文小而快。
    const ollama = defaultProfiles().find((p) => p.id === 'ollama');
    expect(ollama?.capabilities?.maxContextWindow).toBe(8192);
  });
});

describe('loadConfig', () => {
  it('returns the defaults with no key when nothing is configured', () => {
    tempHome();
    const config = loadConfig();
    expect(config.providers.map((p) => p.id)).toEqual(['opencode-zen', 'openrouter', 'ollama']);
    expect(config.providers.find((p) => p.id === 'openrouter')?.apiKey).toBeUndefined();
  });

  it('resolves a key from keys.json', () => {
    const home = tempHome();
    fs.writeFileSync(path.join(home, 'keys.json'), JSON.stringify({ openrouter: 'sk-from-file-1234567890' }));
    const config = loadConfig();
    expect(config.providers.find((p) => p.id === 'openrouter')?.apiKey).toBe('sk-from-file-1234567890');
  });

  it('resolves a key from the environment, and keys.json wins over the environment', () => {
    const home = tempHome();
    vi.stubEnv('CAMELIA_OPENROUTER_API_KEY', 'sk-from-env-1234567890');
    expect(loadConfig().providers.find((p) => p.id === 'openrouter')?.apiKey).toBe('sk-from-env-1234567890');

    fs.writeFileSync(path.join(home, 'keys.json'), JSON.stringify({ openrouter: 'sk-from-file-1234567890' }));
    expect(loadConfig().providers.find((p) => p.id === 'openrouter')?.apiKey).toBe('sk-from-file-1234567890');
  });

  it('reads model, gruntModel and preferredProvider from config.json', () => {
    const home = tempHome();
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify({ model: 'qwen3-coder', gruntModel: 'llama3.2:3b', preferredProvider: 'ollama' }),
    );
    const config = loadConfig();
    expect(config.model).toBe('qwen3-coder');
    expect(config.gruntModel).toBe('llama3.2:3b');
    expect(config.preferredProvider).toBe('ollama');
  });

  it('never throws on malformed JSON on disk', () => {
    const home = tempHome();
    fs.writeFileSync(path.join(home, 'keys.json'), '{ not json');
    fs.writeFileSync(path.join(home, 'config.json'), 'also not json');
    expect(() => loadConfig()).not.toThrow();
  });

  it('ignores disk when skipFiles is set', () => {
    const home = tempHome();
    fs.writeFileSync(path.join(home, 'keys.json'), JSON.stringify({ openrouter: 'sk-file-1234567890' }));
    expect(loadConfig({ skipFiles: true }).providers.find((p) => p.id === 'openrouter')?.apiKey).toBeUndefined();
  });

  it('lets an explicit provider list replace the defaults', () => {
    const config = loadConfig({
      skipFiles: true,
      providers: [
        { id: 'custom', label: 'Custom', kind: 'openai-compatible', baseUrl: 'http://x/v1', models: ['m'], apiKey: 'k' },
      ],
    });
    expect(config.providers.map((p) => p.id)).toEqual(['custom']);
  });
});

describe('usableProfiles', () => {
  it('keeps Ollama (keyless) and drops keyed providers with no key', () => {
    const config = loadConfig({ skipFiles: true });
    expect(usableProfiles(config).map((p) => p.id)).toEqual(['ollama']);
  });

  it('keeps a keyed provider once its key resolves', () => {
    tempHome();
    vi.stubEnv('CAMELIA_OPENROUTER_API_KEY', 'sk-env-1234567890');
    const usable = usableProfiles(loadConfig()).map((p) => p.id);
    expect(usable).toContain('openrouter');
    expect(usable).toContain('ollama');
  });

  it('always keeps mock providers (offline mode)', () => {
    const config: CameliaConfig = {
      providers: [
        { id: 'mock', label: 'Mock', kind: 'mock', baseUrl: '', models: ['scripted'] },
        { id: 'openrouter', label: 'OR', kind: 'openai-compatible', baseUrl: 'http://x/v1', models: ['m'] },
      ],
    };
    expect(usableProfiles(config).map((p) => p.id)).toEqual(['mock']);
  });

  it('moves the preferred provider to the front of the chain', () => {
    const config: CameliaConfig = {
      providers: [
        { id: 'a', label: 'A', kind: 'mock', baseUrl: '', models: ['m'] },
        { id: 'b', label: 'B', kind: 'mock', baseUrl: '', models: ['m'] },
      ],
      preferredProvider: 'b',
    };
    expect(usableProfiles(config).map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('Camelia home layout', () => {
  it('resolves every persisted artifact under the home directory', () => {
    const home = tempHome();
    expect(cameliaHome()).toBe(home);
    expect(paths.keys()).toBe(path.join(home, 'keys.json'));
    expect(paths.database()).toBe(path.join(home, 'camelia.db'));
    expect(paths.backups()).toBe(path.join(home, 'backups'));
  });

  it('creates the full tree on first run', () => {
    const home = tempHome();
    const created = ensureCameliaHome();
    expect(created).toBe(home);
    for (const dir of [home, paths.logs(), paths.certs(), paths.backups()]) {
      expect(fs.existsSync(dir)).toBe(true);
    }
  });

  it('is idempotent when the tree already exists', () => {
    tempHome();
    ensureCameliaHome();
    expect(() => ensureCameliaHome()).not.toThrow();
  });
});