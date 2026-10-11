/**
 * Configuration loading.
 *
 * Precedence, highest first: explicit code → environment variables → `keys.json`
 * → `config.json` → built-in defaults. Keys never come from the repository and
 * never leave `~/.camelia/` (whitepaper §3.8).
 * @module
 */

import fs from 'node:fs';

import type { McpConfigIssue, McpServerConfig, ProviderCapabilities } from '@camelia/core';
import { parseMcpConfig } from '@camelia/core';

import { keyEnvVars, paths } from './paths.js';

export interface ProviderProfile {
  id: string;
  label: string;
  /** Only `openai-compatible` ships today; `mock` exists for offline testing. */
  kind: 'openai-compatible' | 'mock';
  baseUrl: string;
  /** Resolved API key, if any. */
  apiKey?: string;
  models: string[];
  defaultModel?: string;
  capabilities?: Partial<ProviderCapabilities>;
  headers?: Record<string, string>;
}

export interface CameliaConfig {
  providers: ProviderProfile[];
  /** Model used for decision-grade calls; empty means "first available". */
  model?: string;
  /** Model used for grunt work (summaries). Empty means "same as model". */
  gruntModel?: string;
  /** Persisted provider preference from `camelia provider use`. */
  preferredProvider?: string;
  /** `always` waits for a person before execution. Default when omitted. */
  planApproval?: 'always' | 'auto';
}

/** The three free paths, in fallback order (whitepaper appendix A, rule 9). */
export function defaultProfiles(): ProviderProfile[] {
  return [
    {
      id: 'opencode-zen',
      label: 'OpenCode Zen',
      kind: 'openai-compatible',
      baseUrl: process.env.CAMELIA_OPENCODE_ZEN_BASE_URL ?? 'https://opencode.ai/zen/v1',
      models: ['claude-3-5-haiku', 'qwen2.5-coder-32b', 'deepseek-chat'],
      defaultModel: 'claude-3-5-haiku',
      capabilities: { supportsTools: true, supportsJson: true, maxContextWindow: 128_000, quality: 0.7 },
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      kind: 'openai-compatible',
      baseUrl: process.env.CAMELIA_OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      models: [
        'deepseek/deepseek-chat-v3.1:free',
        'qwen/qwen3-coder:free',
        'meta-llama/llama-3.3-70b-instruct:free',
      ],
      defaultModel: 'deepseek/deepseek-chat-v3.1:free',
      capabilities: { supportsTools: true, supportsJson: true, maxContextWindow: 128_000, quality: 0.55 },
      headers: { 'x-title': 'Camelia' },
    },
    {
      id: 'ollama',
      label: 'Ollama (local)',
      kind: 'openai-compatible',
      baseUrl: `${process.env.OLLAMA_HOST ?? 'http://localhost:11434'}/v1`,
      models: ['qwen2.5-coder:7b', 'llama3.2:3b'],
      defaultModel: 'qwen2.5-coder:7b',
      // 能力声明来自实测，不是猜测。见 `scripts/probe-tools.mjs`。
      //
      // 实测（RTX 3060 Laptop 6GB / 15.2GB RAM / Ollama 0.40.2）：
      // - 工具调用：模型**理解**工具语义并能精确输出 Camelia 需要的
      //   `{"tool":..,"arguments":..}` 结构，但走的是提示词约束而非原生
      //   function-calling 通道（Ollama 内置 qwen2.5 模板 instruct 模型输出
      //   `<tool_call>` XML 文本）。因此 `supportsTools: true` 成立 ——
      //   它能发起工具调用，只是需要提示词约定格式。
      // - 吞吐：29.5 tokens/s（418 tokens / 14.2s），模型完整驻留显存
      //   （4191/ 6144 MiB），未溢出到系统内存。
      capabilities: {
        supportsTools: true,
        // 无原生 function-calling 通道：模型理解工具但把调用写成文本。
        // 置为 true 会让 Executor 在提示词里给出确切的输出格式，
        // 并启用 `text-tool-calls` 的文本兜底解析。
        textToolCalls: true,
        supportsJson: true,
        // 8192 而非模型原生的 32k：6GB 显存上长上下文会把 KV cache 挤出显存，
        // Ollama 回退到系统内存后延迟高一个数量级。宁可上下文小而快。
        // 覆盖方式：CAMELIA_OLLAMA_CONTEXT=16384 camelia run "..."
        maxContextWindow: Number(process.env.CAMELIA_OLLAMA_CONTEXT ?? 8192),
        quality: 0.4,
      },
    },
  ];
}

function readJson<T>(file: string): T | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function envKey(candidates: readonly string[]): string | undefined {
  for (const name of candidates) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export interface LoadConfigOptions {
  /** Override the whole provider list (tests, `--provider`). */
  providers?: ProviderProfile[];
  /** Disable reading from disk (tests). */
  skipFiles?: boolean;
}

/** Resolve the effective configuration. Never throws. */
export function loadConfig(options: LoadConfigOptions = {}): CameliaConfig {
  const fileConfig = options.skipFiles
    ? undefined
    : readJson<Partial<CameliaConfig> & { providers?: Partial<ProviderProfile>[] }>(paths.config());
  const keys = options.skipFiles
    ? undefined
    : readJson<Record<string, string>>(paths.keys());

  const base = options.providers ?? defaultProfiles();

  const providers = base.map((profile) => {
    const fromFile = fileConfig?.providers?.find((p) => p.id === profile.id);
    const fromKeys = keys?.[profile.id];
    const fromEnv =
      profile.id === 'opencode-zen'
        ? envKey(keyEnvVars.opencodeZen)
        : profile.id === 'openrouter'
          ? envKey(keyEnvVars.openrouter)
          : profile.id === 'ollama'
            ? envKey(keyEnvVars.ollama)
            : undefined;

    return {
      ...profile,
      ...(fromFile ?? {}),
      id: profile.id,
      kind: fromFile?.kind ?? profile.kind,
      baseUrl: fromFile?.baseUrl ?? profile.baseUrl,
      models: fromFile?.models ?? profile.models,
      defaultModel: fromFile?.defaultModel ?? profile.defaultModel,
      apiKey: fromKeys ?? fromEnv ?? fromFile?.apiKey,
    } satisfies ProviderProfile;
  });

  return {
    providers,
    model: fileConfig?.model,
    gruntModel: fileConfig?.gruntModel,
    preferredProvider: fileConfig?.preferredProvider,
    planApproval: fileConfig?.planApproval === 'auto' ? 'auto' : fileConfig?.planApproval === 'always' ? 'always' : undefined,
  };
}

/**
 * Providers that are actually usable: keyless ones (Ollama) always are, keyed
 * ones only when a key resolved.
 */
export function usableProfiles(config: CameliaConfig): ProviderProfile[] {
  const ordered = [...config.providers];
  if (config.preferredProvider) {
    const idx = ordered.findIndex((p) => p.id === config.preferredProvider);
    if (idx > 0) {
      const [preferred] = ordered.splice(idx, 1);
      if (preferred) ordered.unshift(preferred);
    }
  }
  return ordered.filter((p) => p.kind === 'mock' || p.id === 'ollama' || Boolean(p.apiKey));
}
/**
 * Load MCP server definitions from `~/.camelia/mcp.json`.
 *
 * A missing file is normal (the feature is opt-in) and yields no servers. A
 * malformed file yields whatever parsed cleanly plus the issues — the same
 * fail-soft-per-server rule as the plugin loader, because one bad entry must not
 * disable the servers the user configured correctly.
 *
 * The file is **data only**: it names commands and URLs, and Camelia executes a
 * command the user wrote themselves. Nothing in it is evaluated.
 */
export function loadMcpServers(file?: string): { servers: McpServerConfig[]; issues: McpConfigIssue[] } {
  const target = file ?? paths.mcp();
  if (!fs.existsSync(target)) return { servers: [], issues: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    return { servers: [], issues: [{ path: target, message: `invalid JSON: ${(error as Error).message}` }] };
  }
  return parseMcpConfig(parsed);
}
