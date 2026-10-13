import { describe, expect, it } from 'vitest';
import {
  formatLocalNow,
  inferSupportsVision,
  localNowPromptLine,
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
  });
});
