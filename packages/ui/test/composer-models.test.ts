import { describe, expect, it } from 'vitest';

import { composerModelChoices, describeModelChoice, modelPassesFilter } from '../src/lib/composer-models.js';

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

describe('model capability filters', () => {
  it('marks vision from the id and refuses a generic context as long', () => {
    const vision = describeModelChoice({ id: 'qwen-vl-plus', providerId: 'aliyun' });
    const unknown = describeModelChoice({ id: 'acme-custom', providerId: 'acme' });
    expect(vision.supportsVision).toBe(true);
    expect(vision.capabilitySource?.vision).toBe('inferred');
    expect(modelPassesFilter(vision, 'vision')).toBe(true);
    expect(unknown.capabilitySource?.context).toBe('default');
    expect(modelPassesFilter(unknown, 'context')).toBe(false);
    expect(modelPassesFilter(unknown, 'vision')).toBe(false);
    expect(modelPassesFilter(vision, 'context')).toBe(true);
  });

  it('keeps an advertised window even when the id is unknown', () => {
    const detail = describeModelChoice({
      id: 'vendor/custom',
      providerId: 'openrouter',
      advertised: {
        id: 'vendor/custom',
        label: 'vendor/custom',
        contextWindow: 200_000,
        supportsVision: false,
        supportsTools: true,
        supportsJson: true,
        capabilitySource: { vision: 'advertised', context: 'advertised', tools: 'advertised' },
      },
    });
    expect(modelPassesFilter(detail, 'context')).toBe(true);
    expect(modelPassesFilter(detail, 'vision')).toBe(false);
  });
});
