/**
 * Tool contracts.
 *
 * Tools are the only way the harness touches the outside world. Keeping the
 * `Tool` shape narrow is what makes the engine auditable, approvable and
 * rollback-able (whitepaper §3.7).
 * @module
 */

import type { JsonSchema, JsonValue, RiskLevel, ShellPort, FsPort, SearchPort, LoggerPort, ClockPort } from '@camelia/core';
import type { WorkspaceJournal } from '../checkpoint/WorkspaceJournal.js';
import type { ApprovalMode } from '../config.js';

/** Everything a tool implementation may use. Deliberately minimal. */
export interface ToolContext {
  /** Absolute workspace root. Relative tool paths resolve against it. */
  workspace: string;
  /**
   * Extra absolute directories tools may read/write besides `workspace`.
   * Permission mode FULL does not expand this list — configure roots explicitly.
   */
  extraAllowPaths?: readonly string[];
  fs: FsPort;
  shell: ShellPort;
  search: SearchPort;
  logger: LoggerPort;
  clock: ClockPort;
  /** Records original file contents so writes can be rolled back. */
  journal: WorkspaceJournal;
  signal: AbortSignal;
}

export interface Tool<TInput = JsonValue, TOutput = JsonValue> {
  /** Unique, dot-namespaced name, e.g. `fs.edit`. */
  name: string;
  /**
   * Semantic layer (Iteration 20 — three-layer tool knowledge).
   *
   * One line, resident in the model-visible tool list: only *when to use, why,
   * and what risk*. No concrete syntax, flags or examples here — those live in
   * `usage` and are injected on demand.
   */
  description: string;
  /**
   * Usage layer (on-demand). Concrete commands, flags, examples and gotchas.
   * NOT part of the resident tool list; injected when the model picks this tool
   * and gets the syntax wrong (see Executor).
   */
  usage?: string;
  /** JSON Schema for `input`; validated before execution. */
  schema: JsonSchema;
  risk: RiskLevel;
  /** True when the effect can be undone by restoring journaled content. */
  reversible: boolean;
  /**
   * Per-tool approval override, winning over the risk-based policy.
   *
   * Plugin tools set this to `'ask'` so a tool that arrives after install is never
   * silently auto-approved just because its declared risk is low (whitepaper §8.2).
   */
  approval?: ApprovalMode;
  run(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

export type ToolResult =
  | { ok: true; output: JsonValue; durationMs: number }
  | { ok: false; error: string; retryable: boolean; durationMs: number };

/** Classify a tool failure so ErrorRecovery can pick a strategy. */
export function isRetryableError(message: string): boolean {
  const retryable = [
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'timeout',
    'timed out',
    'rate limit',
    '429',
    '503',
    'temporarily unavailable',
  ];
  const lower = message.toLowerCase();
  return retryable.some((needle) => lower.includes(needle.toLowerCase()));
}