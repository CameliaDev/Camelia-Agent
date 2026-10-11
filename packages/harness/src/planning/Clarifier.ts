/**
 * Clarifier (whitepaper §1.2, stage `received → clarifying`).
 *
 * Converts a raw user request into a `ClarifiedIntent`. It never asks a question
 * in prose: anything the user did not specify becomes an explicit assumption, so
 * the plan is always built on stated premises rather than hidden ones.
 * @module
 */

import type { ClarifiedIntent } from '@camelia/core';

import type { RunContext } from '../context/RunContext.js';
import { workspaceSummary } from '../context/workspace-summary.js';
import type { ModelGateway } from '../model/ModelGateway.js';
import { clarifySystemPrompt } from '../prompts/system.js';
import { extractJsonObject } from '../planning/json.js';
import { allowedPathEnum, listWorkspaceEntries } from './paths.js';

export interface ClarifyOptions {
  /** Skip the model call and use a deterministic restatement (tests, `--no-clarify`). */
  offline?: boolean;
  workspaceSummaryOverride?: string;
}

interface RawIntent {
  goal?: unknown;
  assumptions?: unknown;
  constraints?: unknown;
  expectedPaths?: unknown;
  complete?: unknown;
}

export class Clarifier {
  constructor(
    private readonly gateway: ModelGateway,
    private readonly ctx: RunContext,
  ) {}

  async clarify(rawIntent: string, options: ClarifyOptions = {}): Promise<ClarifiedIntent> {
    if (options.offline || !this.gateway.capabilities().supportsJson) {
      return this.fallback(rawIntent);
    }

    const summary =
      options.workspaceSummaryOverride ??
      (await workspaceSummary(this.ctx.ports.fs, this.ctx.workspace, { maxEntries: 60 }));

    try {
      const result = await this.gateway.call({
        purpose: 'clarify',
        system: clarifySystemPrompt({ rawIntent, workspaceSummary: summary }),
        messages: [{ role: 'user', content: 'Restate the request as an executable goal now.' }],
        responseFormat: 'json',
        maxTokens: 600,
      });
      const parsed = extractJsonObject<RawIntent>(result.text);
      if (!parsed) return this.fallback(rawIntent);

      const stated = asString(parsed.goal, rawIntent);
      const goal = stated === 'Restate the request as an executable goal now.' ? rawIntent.trim() : stated;
      return {
        goal,
        assumptions: asStringArray(parsed.assumptions),
        constraints: asStringArray(parsed.constraints),
        expectedPaths: await this.deterministicPaths(rawIntent),
        complete: parsed.complete !== false,
      };
    } catch (error) {
      this.ctx.infra.logger.warn('clarification failed; using raw intent', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.fallback(rawIntent);
    }
  }

  /** Deterministic restatement — always available, never wrong. */
  private async fallback(rawIntent: string): Promise<ClarifiedIntent> {
    return {
      goal: rawIntent.trim(),
      assumptions: ['The request is actionable as written.'],
      constraints: [],
      expectedPaths: await this.deterministicPaths(rawIntent),
      complete: true,
    };
  }

  /** The path enum comes from the listing. The model text is not a source. */
  private async deterministicPaths(rawIntent: string): Promise<string[]> {
    const entries = await listWorkspaceEntries(this.ctx.ports.fs, this.ctx.workspace);
    return allowedPathEnum(entries, this.ctx.workspace, rawIntent);
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim());
}