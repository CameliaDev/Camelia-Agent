/**
 * Provider preset avatars.
 * @module
 */
import { describe, expect, it } from 'vitest';

import { PROVIDER_AVATAR_URL, primaryPresetAvatarSrc, providerAvatarSrc } from '../src/lib/provider-avatars.js';

describe('providerAvatarSrc', () => {
  it('gives Aliyun the product/app icon (first preset)', () => {
    expect(providerAvatarSrc('aliyun')).toBe(PROVIDER_AVATAR_URL.aliyun);
    expect(primaryPresetAvatarSrc()).toBe(PROVIDER_AVATAR_URL.aliyun);
  });

  it('keeps Ollama / OpenRouter / Zen distinct from Aliyun', () => {
    const ids = ['ollama', 'openrouter', 'opencode-zen'] as const;
    const urls = ids.map((id) => providerAvatarSrc(id));
    expect(new Set(urls).size).toBe(3);
    for (const url of urls) {
      expect(url).not.toBe(providerAvatarSrc('aliyun'));
    }
  });

  it('falls back to a data-URI disc for unknown custom ids', () => {
    const url = providerAvatarSrc('my-corp-llm');
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
  });
});
