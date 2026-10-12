/**
 * Connection preset helpers.
 * @module
 */
import { describe, expect, it } from 'vitest';

import {
  PRESET_TEMPLATES,
  buildPresetCards,
  slugifyProviderId,
  uniqueProviderId,
} from '../src/window/provider-presets.js';

describe('slugifyProviderId', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyProviderId('Aliyun Work')).toBe('aliyun-work');
  });

  it('falls back when empty', () => {
    expect(slugifyProviderId('***', 'custom')).toBe('custom');
  });
});

describe('uniqueProviderId', () => {
  it('keeps the desired id when free', () => {
    expect(uniqueProviderId('aliyun', ['ollama'])).toBe('aliyun');
  });

  it('suffixes when taken', () => {
    expect(uniqueProviderId('aliyun', ['aliyun', 'aliyun-2'])).toBe('aliyun-3');
  });

  it('allows the id being edited', () => {
    expect(uniqueProviderId('aliyun', ['aliyun', 'ollama'], 'aliyun')).toBe('aliyun');
  });
});

describe('buildPresetCards', () => {
  it('merges config providers with builtin templates', () => {
    const cards = buildPresetCards({
      providers: [
        {
          id: 'aliyun',
          label: '阿里云',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          models: ['qwen-plus'],
          defaultModel: 'qwen-plus',
        },
      ],
      preferredProvider: 'ollama',
      model: 'qwen2.5-coder:7b',
      keyStatus: { aliyun: { configured: true, hint: '····abcd' } },
    });
    const ids = cards.map((c) => c.id);
    expect(ids).toContain('aliyun');
    expect(ids).toContain('ollama');
    expect(ids).toContain('openrouter');
    const aliyun = cards.find((c) => c.id === 'aliyun')!;
    expect(aliyun.persisted).toBe(true);
    expect(aliyun.keyConfigured).toBe(true);
    expect(aliyun.active).toBe(false);
    const ollama = cards.find((c) => c.id === 'ollama')!;
    expect(ollama.active).toBe(true);
    expect(ollama.model).toBe('qwen2.5-coder:7b');
    expect(ollama.persisted).toBe(false);
  });

  it('exposes the five wireframe templates including 阿里云兼容 / 自定义', () => {
    const ids = PRESET_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(['aliyun', 'openrouter', 'opencode-zen', 'ollama', 'custom']);
    expect(PRESET_TEMPLATES[0]?.label).toContain('阿里云');
    expect(PRESET_TEMPLATES[4]?.label).toBe('自定义');
  });
});
