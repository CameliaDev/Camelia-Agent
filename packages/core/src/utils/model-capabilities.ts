/**
 * Per-model capability metadata (vision, context window, tools, JSON).
 *
 * Provider-level capabilities are a coarse default. Individual models on the
 * same endpoint differ (qwen-plus vs qwen-vl-plus). Config may override via
 * `providers[].modelCapabilities`; otherwise we infer from the model id.
 * @module
 */

import type { ModelInfo, ProviderCapabilities } from '../types/domain.js';

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
  const id = modelId.toLowerCase();
  if (id.includes('qwen-long') || id.includes('gemini-1.5-pro')) return 1_000_000;
  if (id.includes('claude') && (id.includes('sonnet') || id.includes('opus') || id.includes('3-5') || id.includes('3.5') || id.includes('4'))) {
    return 200_000;
  }
  if (id.includes('gpt-4o') || id.includes('gpt-4.1') || id.includes('o1') || id.includes('o3')) return 128_000;
  if (id.includes('qwen') && (id.includes('plus') || id.includes('max') || id.includes('turbo') || id.includes('vl'))) {
    return 131_072;
  }
  if (id.includes(':7b') || id.includes('7b-') || id.includes('3b') || id.includes('1b')) {
    return providerMax && providerMax > 0 ? Math.min(providerMax, 32_768) : 8192;
  }
  return providerMax && providerMax > 0 ? providerMax : 128_000;
}

export function resolveModelInfo(input: {
  id: string;
  providerId: string;
  providerCaps: ProviderCapabilities;
  override?: ModelCapabilitySpec;
}): ModelInfo {
  const { id, providerId, providerCaps, override } = input;
  const supportsVision =
    override?.supportsVision ??
    providerCaps.supportsVision ??
    inferSupportsVision(id);
  return {
    id,
    providerId,
    label: override?.label?.trim() || id,
    contextWindow: override?.contextWindow ?? inferContextWindow(id, providerCaps.maxContextWindow),
    supportsTools: override?.supportsTools ?? providerCaps.supportsTools,
    supportsJson: override?.supportsJson ?? providerCaps.supportsJson,
    supportsVision,
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
