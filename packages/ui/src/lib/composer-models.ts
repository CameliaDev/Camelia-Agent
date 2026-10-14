/**
 * Models the composer picker can offer without opening Settings.
 *
 * The live `/v1/models` list is often one id, or empty after a 401 (Aliyun's
 * compatible endpoint does this). The picker still has to offer the ids the
 * user already configured and the known catalog for that provider, plus
 * whatever they type.
 * @module
 */

import { PRESET_TEMPLATES } from '../window/provider-presets.js';

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
