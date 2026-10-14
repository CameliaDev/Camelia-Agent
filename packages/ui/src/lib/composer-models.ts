/**
 * Models the composer picker can offer without opening Settings.
 *
 * The live `/v1/models` list is often one id, or empty after a 401 (Aliyun's
 * compatible endpoint does this). The picker still has to offer the ids the
 * user already configured and the known catalog for that provider, plus
 * whatever they type.
 * @module
 */

import { resolveModelInfo } from '@camelia/core/capabilities';
import type { ProviderModelDetail } from '@camelia/agent/view';

import { PRESET_TEMPLATES } from '../window/provider-presets.js';

export type ModelFilter = 'all' | 'vision' | 'context';

/** Long-context filter. A generic 128k default does not count. */
export const LONG_CONTEXT_TOKENS = 100_000;

const GENERIC_CAPS = {
  supportsTools: true,
  supportsJson: true,
  supportsStreaming: true,
  maxContextWindow: 0,
  quality: 0.5,
};

/** Known model ids for a provider, including `aliyun-2` style duplicates. */
export function catalogModels(providerId: string | undefined): readonly string[] {
  if (!providerId) return [];
  const exact = PRESET_TEMPLATES.find((item) => item.id === providerId);
  if (exact && exact.models.length > 0) return exact.models;
  const prefixed = PRESET_TEMPLATES.find(
    (item) => item.id !== 'custom' && item.models.length > 0 && providerId.startsWith(`${item.id}-`),
  );
  return prefixed?.models ?? [];
}

/**
 * Advertised ids first (the configured set), then catalog ids the list missed,
 * then the model that is already selected.
 *
 * A list tagged for a different provider is ignored. Offering OpenRouter ids
 * under Aliyun would switch vendor by accident.
 */
export function composerModelChoices(input: {
  providerId?: string;
  activeModel?: string;
  advertised?: readonly string[];
  advertisedFor?: string;
}): string[] {
  const out: string[] = [];
  const push = (id: string | undefined): void => {
    const trimmed = id?.trim();
    if (!trimmed || out.includes(trimmed)) return;
    out.push(trimmed);
  };
  const sameProvider =
    input.providerId !== undefined &&
    (input.advertisedFor === undefined || input.advertisedFor === input.providerId);
  if (sameProvider) {
    for (const id of input.advertised ?? []) push(id);
  }
  for (const id of catalogModels(input.providerId)) push(id);
  push(input.activeModel);
  return out;
}

/**
 * Caps for one picker row. Advertised engine details win; otherwise the id
 * heuristic fills vision and context, and says when the window is only a default.
 */
export function describeModelChoice(input: {
  id: string;
  providerId?: string;
  advertised?: ProviderModelDetail;
}): ProviderModelDetail {
  if (input.advertised) return input.advertised;
  const info = resolveModelInfo({
    id: input.id,
    providerId: input.providerId || 'unknown',
    providerCaps: GENERIC_CAPS,
  });
  return {
    id: info.id,
    label: info.label,
    contextWindow: info.contextWindow,
    supportsVision: info.supportsVision,
    supportsTools: info.supportsTools,
    supportsJson: info.supportsJson,
    ...(info.capabilitySource ? { capabilitySource: info.capabilitySource } : {}),
  };
}

export function modelPassesFilter(detail: ProviderModelDetail | undefined, filter: ModelFilter): boolean {
  if (filter === 'all') return true;
  if (!detail) return false;
  if (filter === 'vision') return detail.supportsVision === true && detail.capabilitySource?.vision !== 'unknown';
  if (detail.capabilitySource?.context === 'default') return false;
  return detail.contextWindow >= LONG_CONTEXT_TOKENS;
}
