import { describe, expect, it } from 'vitest';
import {
  catalogRowAdvertisesCaps,
  formatLocalNow,
  inferSupportsVision,
  localNowPromptLine,
  parseModelCatalog,
  resolveModelInfo,
} from '../src/index.js';

describe('local-time', () => {
  it('formats Asia/Shanghai and mentions 2026 for a fixed instant', () => {
    // 2026-10-13 21:00:00+08:00
    const ms = Date.parse('2026-10-13T13:00:00.000Z');
    const line = formatLocalNow(ms, 'Asia/Shanghai');
    expect(line).toContain('2026-10-13');
    expect(line).toContain('Asia/Shanghai');
    expect(localNowPromptLine(ms)).toContain('Current local date/time');
    expect(localNowPromptLine(ms)).toContain('2026');
  });
});

describe('model-capabilities', () => {
  it('infers vision for qwen-vl and not for plain coder', () => {
    expect(inferSupportsVision('qwen-vl-plus')).toBe(true);
    expect(inferSupportsVision('qwen2.5-coder:7b')).toBe(false);
  });

  it('honours config overrides over inference', () => {
    const info = resolveModelInfo({
      id: 'custom-coder',
      providerId: 'x',
      providerCaps: {
        supportsTools: true,
        supportsJson: true,
        supportsStreaming: true,
        maxContextWindow: 8192,
        quality: 0.4,
      },
      override: { supportsVision: true, contextWindow: 64000 },
    });
    expect(info.supportsVision).toBe(true);
    expect(info.contextWindow).toBe(64000);
    expect(info.capabilitySource?.vision).toBe('override');
    expect(info.capabilitySource?.context).toBe('override');
  });

  it('leaves a bare id unknown for vision and default for context', () => {
    const info = resolveModelInfo({
      id: 'acme-custom',
      providerId: 'acme',
      providerCaps: {
        supportsTools: true,
        supportsJson: false,
        supportsStreaming: true,
        maxContextWindow: 0,
        quality: 0.2,
      },
    });
    expect(info.supportsVision).toBe(false);
    expect(info.capabilitySource?.vision).toBe('unknown');
    expect(info.contextWindow).toBe(128_000);
    expect(info.capabilitySource?.context).toBe('default');
    expect(info.supportsJson).toBe(false);
  });

  it('prefers an advertised context and image modality over the id heuristic', () => {
    const info = resolveModelInfo({
      id: 'vendor/custom-small',
      providerId: 'openrouter',
      providerCaps: {
        supportsTools: false,
        supportsJson: false,
        supportsStreaming: true,
        maxContextWindow: 8192,
        quality: 0.4,
      },
      advertised: { contextWindow: 32_000, supportsVision: true, supportsTools: true },
    });
    expect(info.contextWindow).toBe(32_000);
    expect(info.supportsVision).toBe(true);
    expect(info.supportsTools).toBe(true);
    expect(info.capabilitySource).toMatchObject({
      vision: 'advertised',
      context: 'advertised',
      tools: 'advertised',
    });
  });

  it('parses OpenRouter-style rows and ignores missing fields', () => {
    const rows = parseModelCatalog({
      data: [
        {
          id: 'openai/gpt-4o',
          context_length: 128000,
          architecture: { modality: 'text+image->text', input_modalities: ['text', 'image'] },
          supported_parameters: ['tools', 'response_format'],
        },
        { id: 'qwen-plus' },
        'llama3.2:3b',
      ],
    });
    expect(rows.map((row) => row.id)).toEqual(['openai/gpt-4o', 'qwen-plus', 'llama3.2:3b']);
    expect(rows[0]).toMatchObject({
      contextWindow: 128000,
      supportsVision: true,
      supportsTools: true,
      supportsJson: true,
    });
    expect(catalogRowAdvertisesCaps(rows[0]!)).toBe(true);
    expect(catalogRowAdvertisesCaps(rows[1]!)).toBe(false);
    expect(rows[1]?.supportsVision).toBeUndefined();
    expect(rows[1]?.contextWindow).toBeUndefined();
  });

  it('reads DashScope output.models and top_provider context', () => {
    const rows = parseModelCatalog({
      output: {
        models: [{ model: 'qwen-vl-max', top_provider: { context_length: 131072 }, vision: true }],
      },
    });
    expect(rows).toEqual([{ id: 'qwen-vl-max', contextWindow: 131072, supportsVision: true }]);
  });
});
