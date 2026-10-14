/**
 * Per-model capability metadata (vision, context window, tools, JSON).
 *
 * Provider-level capabilities are a coarse default. Individual models on the
 * same endpoint differ (qwen-plus vs qwen-vl-plus). Config may override via
 * `providers[].modelCapabilities`; otherwise we infer from the model id.
 * @module
 */

import type { CapabilityOrigin, ModelInfo, ProviderCapabilities } from '../types/domain.js';

/** Optional overrides stored under `providers[].modelCapabilities[modelId]`. */
export interface ModelCapabilitySpec {
  contextWindow?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsJson?: boolean;
  label?: string;
}

const VISION_HINTS = [
  'vision',
  '-vl',
  'vl-',
  'vl_',
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'gemini-1.5',
  'gemini-2',
  'gemini-flash',
  'gemini-pro',
  'claude-3',
  'claude-3.5',
  'claude-3-5',
  'claude-3-7',
  'claude-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'llava',
  'moondream',
  'minicpm-v',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen-vl',
  'internvl',
  'phi-3-vision',
  'phi-4-multimodal',
];

/** Heuristic: does this model id look multimodal / vision-capable? */
export function inferSupportsVision(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return VISION_HINTS.some((hint) => id.includes(hint));
}

/** Heuristic context window when config does not pin one. */
export function inferContextWindow(modelId: string, providerMax?: number): number {
  return inferContextDetail(modelId, providerMax).window;
}

/**
 * Same window as `inferContextWindow`. `specific` is false when the number is
 * only the provider max or the generic 128k fallback — not evidence of this id.
 */
export function inferContextDetail(modelId: string, providerMax?: number): { window: number; specific: boolean } {
  const id = modelId.toLowerCase();
  if (id.includes('qwen-long') || id.includes('gemini-1.5-pro')) return { window: 1_000_000, specific: true };
  if (id.includes('claude') && (id.includes('sonnet') || id.includes('opus') || id.includes('3-5') || id.includes('3.5') || id.includes('4'))) {
    return { window: 200_000, specific: true };
  }
  if (id.includes('gpt-4o') || id.includes('gpt-4.1') || id.includes('o1') || id.includes('o3')) {
    return { window: 128_000, specific: true };
  }
  if (id.includes('qwen') && (id.includes('plus') || id.includes('max') || id.includes('turbo') || id.includes('vl'))) {
    return { window: 131_072, specific: true };
  }
  if (id.includes(':7b') || id.includes('7b-') || id.includes('3b') || id.includes('1b')) {
    return { window: providerMax && providerMax > 0 ? Math.min(providerMax, 32_768) : 8192, specific: true };
  }
  return { window: providerMax && providerMax > 0 ? providerMax : 128_000, specific: false };
}

export function resolveModelInfo(input: {
  id: string;
  providerId: string;
  providerCaps: ProviderCapabilities;
  /** Config pin. Wins over anything the API advertised. */
  override?: ModelCapabilitySpec;
  /** Fields parsed from a `/v1/models` row. Absent fields stay unknown. */
  advertised?: ModelCapabilitySpec;
}): ModelInfo {
  const { id, providerId, providerCaps, override, advertised } = input;
  const vision = resolveVision(id, providerCaps, override, advertised);
  const context = resolveContext(id, providerCaps, override, advertised);
  const tools = resolveFlag(override?.supportsTools, advertised?.supportsTools, providerCaps.supportsTools);
  const json = resolveFlag(override?.supportsJson, advertised?.supportsJson, providerCaps.supportsJson);
  return {
    id,
    providerId,
    label: override?.label?.trim() || advertised?.label?.trim() || id,
    contextWindow: context.value,
    supportsTools: tools.value,
    supportsJson: json.value,
    supportsVision: vision.value,
    capabilitySource: {
      vision: vision.origin,
      context: context.origin,
      tools: tools.origin,
    },
  };
}

/** Compact label for UI chips, e.g. "128k · vision". */
export function formatModelCapsSummary(info: Pick<ModelInfo, 'contextWindow' | 'supportsVision' | 'supportsTools'>): string {
  const ctx =
    info.contextWindow >= 1_000_000
      ? `${Math.round(info.contextWindow / 1_000_000)}M`
      : info.contextWindow >= 1000
        ? `${Math.round(info.contextWindow / 1000)}k`
        : String(info.contextWindow);
  const bits = [ctx];
  if (info.supportsVision) bits.push('vision');
  if (!info.supportsTools) bits.push('no-tools');
  return bits.join(' · ');
}

function resolveVision(
  id: string,
  providerCaps: ProviderCapabilities,
  override?: ModelCapabilitySpec,
  advertised?: ModelCapabilitySpec,
): { value: boolean; origin: CapabilityOrigin } {
  if (override?.supportsVision !== undefined) return { value: override.supportsVision, origin: 'override' };
  if (advertised?.supportsVision !== undefined) return { value: advertised.supportsVision, origin: 'advertised' };
  if (providerCaps.supportsVision !== undefined) return { value: providerCaps.supportsVision, origin: 'provider' };
  if (inferSupportsVision(id)) return { value: true, origin: 'inferred' };
  return { value: false, origin: 'unknown' };
}

function resolveContext(
  id: string,
  providerCaps: ProviderCapabilities,
  override?: ModelCapabilitySpec,
  advertised?: ModelCapabilitySpec,
): { value: number; origin: CapabilityOrigin } {
  if (override?.contextWindow && override.contextWindow > 0) {
    return { value: override.contextWindow, origin: 'override' };
  }
  if (advertised?.contextWindow && advertised.contextWindow > 0) {
    return { value: advertised.contextWindow, origin: 'advertised' };
  }
  const inferred = inferContextDetail(id, providerCaps.maxContextWindow);
  return { value: inferred.window, origin: inferred.specific ? 'inferred' : 'default' };
}

function resolveFlag(
  override: boolean | undefined,
  advertised: boolean | undefined,
  provider: boolean,
): { value: boolean; origin: CapabilityOrigin } {
  if (override !== undefined) return { value: override, origin: 'override' };
  if (advertised !== undefined) return { value: advertised, origin: 'advertised' };
  return { value: provider, origin: 'provider' };
}

/** One model row parsed from an OpenAI-compatible `/v1/models` body. */
export interface ParsedModelCaps {
  id: string;
  label?: string;
  contextWindow?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsJson?: boolean;
}

const CONTEXT_KEYS = [
  'contextTokens',
  'context_tokens',
  'context_length',
  'context_window',
  'max_context_length',
  'max_model_len',
  'max_input_tokens',
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function readContext(row: Record<string, unknown>): number | undefined {
  for (const key of CONTEXT_KEYS) {
    const n = positiveInt(row[key]);
    if (n) return n;
  }
  const top = asRecord(row.top_provider);
  if (top) {
    const n = positiveInt(top.context_length ?? top.max_context_length);
    if (n) return n;
  }
  return undefined;
}

function readVision(row: Record<string, unknown>): boolean | undefined {
  if (typeof row.supportsVision === 'boolean') return row.supportsVision;
  if (typeof row.vision === 'boolean') return row.vision;
  const arch = asRecord(row.architecture);
  if (arch) {
    const modality = typeof arch.modality === 'string' ? arch.modality.toLowerCase() : '';
    if (modality.includes('image')) return true;
    const inputs = arch.input_modalities;
    if (Array.isArray(inputs) && inputs.some((item) => String(item).toLowerCase() === 'image')) return true;
  }
  if (Array.isArray(row.capabilities) && row.capabilities.some((item) => String(item).toLowerCase() === 'vision')) {
    return true;
  }
  const caps = asRecord(row.capabilities);
  if (caps && typeof caps.vision === 'boolean') return caps.vision;
  return undefined;
}

function readTools(row: Record<string, unknown>): boolean | undefined {
  if (typeof row.supportsTools === 'boolean') return row.supportsTools;
  if (typeof row.tools === 'boolean') return row.tools;
  const params = row.supported_parameters ?? row.supported_features;
  if (Array.isArray(params)) {
    const names = params.map((item) => String(item).toLowerCase());
    if (names.some((name) => name === 'tools' || name === 'tool_choice' || name === 'function_calling')) return true;
  }
  const caps = asRecord(row.capabilities);
  if (caps && typeof caps.tools === 'boolean') return caps.tools;
  return undefined;
}

function readJson(row: Record<string, unknown>): boolean | undefined {
  if (typeof row.supportsJson === 'boolean') return row.supportsJson;
  const params = row.supported_parameters;
  if (Array.isArray(params)) {
    const names = params.map((item) => String(item).toLowerCase());
    if (names.some((name) => name === 'response_format' || name === 'json_mode' || name === 'structured_outputs')) {
      return true;
    }
  }
  return undefined;
}

function parseCatalogRow(row: unknown): ParsedModelCaps | undefined {
  if (typeof row === 'string') {
    const id = row.trim();
    return id ? { id } : undefined;
  }
  const record = asRecord(row);
  if (!record) return undefined;
  const rawId = record.id ?? record.model;
  if (typeof rawId !== 'string' || !rawId.trim()) return undefined;
  const label = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined;
  const contextWindow = readContext(record);
  const supportsVision = readVision(record);
  const supportsTools = readTools(record);
  const supportsJson = readJson(record);
  return {
    id: rawId.trim(),
    ...(label ? { label } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(supportsVision !== undefined ? { supportsVision } : {}),
    ...(supportsTools !== undefined ? { supportsTools } : {}),
    ...(supportsJson !== undefined ? { supportsJson } : {}),
  };
}

function catalogRows(body: unknown): unknown[] {
  const record = asRecord(body);
  if (!record) return [];
  if (Array.isArray(record.data)) return record.data;
  const output = asRecord(record.output);
  if (output && Array.isArray(output.models)) return output.models;
  if (Array.isArray(record.models)) return record.models;
  return [];
}

/**
 * Read a `/v1/models` (or DashScope `output.models`) payload.
 *
 * Ids are always kept. Vision, tools, and context are set only when the row
 * states them — a bare `{ id }` stays unknown so callers can infer later.
 */
export function parseModelCatalog(body: unknown): ParsedModelCaps[] {
  const out: ParsedModelCaps[] = [];
  for (const row of catalogRows(body)) {
    const parsed = parseCatalogRow(row);
    if (!parsed || out.some((item) => item.id === parsed.id)) continue;
    out.push(parsed);
  }
  return out;
}

/** True when the catalog row stated at least one capability, not only an id. */
export function catalogRowAdvertisesCaps(row: ParsedModelCaps): boolean {
  return (
    row.contextWindow !== undefined ||
    row.supportsVision !== undefined ||
    row.supportsTools !== undefined ||
    row.supportsJson !== undefined
  );
}
