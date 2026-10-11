/**
 * Model router (whitepaper §4.8 — multi-model collaboration).
 *
 * Weak models do grunt work (summaries, extraction); the strongest available does
 * decision-grade work (planning, execution). Selection is a pure function of the
 * advertised model list and the capability profile, so it is testable and
 * explainable — never a guess.
 * @module
 */

import type { LLMPort, ProviderCapabilities } from '@camelia/core';

export interface RoutingDecision {
  /** Model for planning/execution. */
  model: string;
  /** Model for summaries and other low-stakes calls. */
  gruntModel: string;
  reason: string;
}

/** Ids that read as "small/cheap" across the free-model landscape. */
const GRUNT_HINTS = ['haiku', 'mini', 'small', '3b', '1.5b', '7b', 'flash', 'nano'];
/** Ids that read as "strong". */
const DECISION_HINTS = ['70b', '32b', 'coder', 'sonnet', 'opus', 'qwen3', 'deepseek'];

export class ModelRouter {
  constructor(
    private readonly port: LLMPort,
    private readonly availableModels: string[],
    private readonly preferred?: { model?: string; gruntModel?: string },
  ) {}

  capabilities(): ProviderCapabilities {
    return this.port.capabilities();
  }

  /** Decide the decision/grunt model pair for this run. */
  decide(): RoutingDecision {
    const models = this.availableModels.length > 0 ? this.availableModels : ['unknown'];

    const decision = this.preferred?.model ?? this.pick(models, DECISION_HINTS) ?? models[0]!;
    const grunt =
      this.preferred?.gruntModel ?? this.pick(models, GRUNT_HINTS) ?? decision;

    const reason = [
      this.preferred?.model ? 'model pinned by config' : `decision model chosen by capability heuristic`,
      this.preferred?.gruntModel ? 'grunt model pinned by config' : 'grunt model chosen by size heuristic',
    ].join('; ');

    return { model: decision, gruntModel: grunt, reason };
  }

  private pick(models: string[], hints: string[]): string | undefined {
    const lowered = models.map((m) => m.toLowerCase());
    for (const hint of hints) {
      const idx = lowered.findIndex((m) => m.includes(hint));
      if (idx !== -1) return models[idx];
    }
    return undefined;
  }
}