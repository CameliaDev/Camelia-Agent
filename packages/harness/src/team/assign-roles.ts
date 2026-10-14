/**
 * Pick a model for a Term role from the provider catalog.
 *
 * Policy:
 * - `requireVision` keeps only models whose vision flag is true and not `unknown`.
 *   Inferred ids (qwen-vl, gpt-4o, …) count. A silent false does not.
 * - `minContextTokens` keeps only windows that were advertised, configured, or
 *   inferred from the id. The generic 128k default does not satisfy a minimum.
 * - `requireTools` keeps models that advertise tool calls.
 * - The preferred id wins when it still qualifies; otherwise the largest context
 *   window wins (vision-capable first when vision is required).
 * - If nothing qualifies, the role is unmet. Callers must not invent a model
 *   and must not mark the team done.
 * @module
 */

import type { ModelInfo } from '@camelia/core';

export interface RoleNeed {
  requireVision?: boolean;
  minContextTokens?: number;
  requireTools?: boolean;
}

export type RolePick =
  | { ok: true; modelId: string; reason: string }
  | { ok: false; reason: string };

export function modelMeetsNeed(model: ModelInfo, need: RoleNeed): boolean {
  if (need.requireVision) {
    if (!model.supportsVision) return false;
    if (model.capabilitySource?.vision === 'unknown') return false;
  }
  if (need.requireTools && !model.supportsTools) return false;
  const min = need.minContextTokens ?? 0;
  if (min > 0) {
    if (model.capabilitySource?.context === 'default') return false;
    if (model.contextWindow < min) return false;
  }
  return true;
}

export function assignRoleModel(catalog: readonly ModelInfo[], need: RoleNeed, preferredId?: string): RolePick {
  const eligible = catalog.filter((model) => modelMeetsNeed(model, need));
  if (eligible.length === 0) {
    return { ok: false, reason: unmetReason(need) };
  }
  const preferred = preferredId ? eligible.find((model) => model.id === preferredId) : undefined;
  const ranked = [...eligible].sort((a, b) => {
    if (need.requireVision && a.supportsVision !== b.supportsVision) return a.supportsVision ? -1 : 1;
    return b.contextWindow - a.contextWindow;
  });
  const chosen = preferred ?? ranked[0]!;
  const why = preferred && preferred.id === chosen.id ? 'preferred model still meets the role' : 'largest matching context window';
  const bits = [
    why,
    need.requireVision ? 'vision required' : undefined,
    need.minContextTokens ? `context >= ${need.minContextTokens}` : undefined,
    need.requireTools ? 'tools required' : undefined,
  ].filter((bit): bit is string => Boolean(bit));
  return { ok: true, modelId: chosen.id, reason: `${chosen.id}: ${bits.join('; ')}` };
}

function unmetReason(need: RoleNeed): string {
  const bits: string[] = [];
  if (need.requireVision) bits.push('vision');
  if (need.requireTools) bits.push('tools');
  if (need.minContextTokens && need.minContextTokens > 0) bits.push(`context >= ${need.minContextTokens}`);
  const ask = bits.length > 0 ? bits.join(', ') : 'the role';
  return `no catalog model satisfies ${ask}`;
}
