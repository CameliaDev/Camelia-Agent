/**
 * OpenAI-compatible model probe, including DashScope's Bearer requirement.
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';

import { normalizeApiKey, testOpenAiCompatible } from '../src/window/model-settings.js';

const ALIYUN = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
});

describe('testOpenAiCompatible', () => {
  it('lists DashScope models with Authorization Bearer on /compatible-mode/v1/models', async () => {
    const seen: { url?: string; authorization?: string } = {};
    const result = await testOpenAiCompatible({
      baseUrl: ALIYUN,
      apiKey: 'sk-valid-beijing',
      fetchImpl: (async (url, init) => {
        seen.url = String(url);
        const headers = new Headers(init?.headers);
        seen.authorization = headers.get('authorization') ?? undefined;
        return jsonResponse(200, {
          object: 'list',
          data: [{ id: 'qwen-plus', object: 'model' }, { id: 'qwen-max' }],
        });
      }) as typeof fetch,
    });
    expect(seen.url).toBe(`${ALIYUN}/models`);
    expect(seen.authorization).toBe('Bearer sk-valid-beijing');
    expect(result).toEqual({ ok: true, models: ['qwen-plus', 'qwen-max'] });
  });

  it('uses the saved key when the password field is empty', async () => {
    const host = globalThis as {
      __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
    };
    host.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          expect(cmd).toBe('read_provider_key');
          expect(args).toEqual({ provider: 'aliyun' });
          return 'sk-saved-key';
        },
      },
    };
    let authorization = '';
    const result = await testOpenAiCompatible({
      baseUrl: `${ALIYUN}/`,
      providerId: 'aliyun',
      fetchImpl: (async (_url, init) => {
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        return jsonResponse(200, { data: [{ id: 'qwen-turbo' }] });
      }) as typeof fetch,
    });
    expect(authorization).toBe('Bearer sk-saved-key');
    expect(result).toEqual({ ok: true, models: ['qwen-turbo'] });
  });

  it('reports a missing key when DashScope answers 401 and no key was sent', async () => {
    const result = await testOpenAiCompatible({
      baseUrl: ALIYUN,
      fetchImpl: (async () =>
        jsonResponse(401, {
          error: {
            message:
              "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY). ",
            type: 'invalid_request_error',
            code: null,
          },
        })) as typeof fetch,
    });
    expect(result).toEqual({ ok: false, error: 'missing-key' });
  });

  it('reports a rejected key when Bearer was sent and DashScope answers invalid_api_key', async () => {
    const result = await testOpenAiCompatible({
      baseUrl: ALIYUN,
      apiKey: 'Bearer sk-wrong-region',
      fetchImpl: (async (_url, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-wrong-region');
        return jsonResponse(401, {
          error: {
            message: 'Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        });
      }) as typeof fetch,
    });
    expect(result).toEqual({ ok: false, error: 'invalid-key' });
  });

  it('reads DashScope native output.models[].model ids', async () => {
    const result = await testOpenAiCompatible({
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'sk-valid',
      fetchImpl: (async () =>
        jsonResponse(200, {
          output: { models: [{ model: 'qwen-plus' }, { model: 'qwen-vl-max' }] },
        })) as typeof fetch,
    });
    expect(result).toEqual({ ok: true, models: ['qwen-plus', 'qwen-vl-max'] });
  });

  it('strips a pasted Bearer prefix', () => {
    expect(normalizeApiKey('  Bearer sk-abc  ')).toBe('sk-abc');
  });
});
