import { describe, expect, it } from 'vitest';

import { composerModelChoices } from '../src/lib/composer-models.js';

describe('composerModelChoices', () => {
  it('keeps a single configured Aliyun id and fills in the known catalog', () => {
    expect(
      composerModelChoices({
        providerId: 'aliyun',
        activeModel: 'qwen-plus',
        advertised: ['qwen-plus'],
        advertisedFor: 'aliyun',
      }),
    ).toEqual(['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-vl-plus', 'qwen-vl-max']);
  });

  it('still offers the catalog when /v1/models came back empty', () => {
    expect(
      composerModelChoices({
        providerId: 'aliyun',
        activeModel: 'qwen-plus',
        advertised: [],
        advertisedFor: 'aliyun',
      }),
    ).toEqual(['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-vl-plus', 'qwen-vl-max']);
  });

  it('does not offer another provider’s advertised ids', () => {
    expect(
      composerModelChoices({
        providerId: 'aliyun',
        activeModel: 'qwen-plus',
        advertised: ['deepseek-v3:free'],
        advertisedFor: 'openrouter',
      }),
    ).toEqual(['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-vl-plus', 'qwen-vl-max']);
  });

  it('keeps a hand-configured id that the catalog does not know', () => {
    expect(
      composerModelChoices({
        providerId: 'acme',
        activeModel: 'acme-small',
        advertised: ['acme-small', 'acme-large'],
        advertisedFor: 'acme',
      }),
    ).toEqual(['acme-small', 'acme-large']);
  });
});
