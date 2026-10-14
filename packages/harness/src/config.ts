/**
 * Harness configuration and defaults.
 *
 * Every knob that changes reliability behaviour lives here so that a task run is
 * fully reproducible from `(config, model, workspace)` (whitepaper §3, §4).
 * @module
 */

import type { CognitionMode, RiskLevel } from '@camelia/core';

/** How the approval gate treats a given risk level. */
export type ApprovalMode = 'auto' | 'ask' | 'deny';

export interface ApprovalPolicy {
  byRisk: Record<RiskLevel, ApprovalMode>;
  /** Workspace-relative path prefixes that may never be written to. */
  deniedPaths: string[];
  /** Substrings that make a shell command unconditionally denied. */
  deniedCommands: string[];
  /** When true, approving one call auto-approves identical calls for the session. */
  rememberSessionApprovals: boolean;
}

export interface HarnessConfig {
  /** Hard ceiling on planned steps; prevents runaway plans. */
  maxSteps: number;
  /** Model/tool iterations allowed inside a single step. */
  maxIterationsPerStep: number;
  /** Tool calls allowed inside a single step. */
  maxToolCallsPerStep: number;
  /** Per-tool wall-clock timeout. */
  toolTimeoutMs: number;
  /** Per-shell-command wall-clock timeout. */
  shellTimeoutMs: number;
  /** Model context window in tokens. */
  contextWindow: number;
  /** Compaction triggers when used/window exceeds this ratio. */
  softLimitRatio: number;
  /** Goal-drift score above which we re-anchor the goal. */
  driftThreshold: number;
  /** Identical action fingerprints before a loop is declared. */
  loopRepeatThreshold: number;
  /** Consecutive steps with no acceptance progress before we intervene. */
  noProgressThreshold: number;
  /** Retries per recoverable failure. */
  maxRetries: number;
  /** Maximum concurrently running sub-agents. */
  maxSubAgents: number;
  /** `auto` picks fast for trivial tasks, full otherwise. */
  plannerMode: 'auto' | 'fast' | 'full';
  approval: ApprovalPolicy;
  /** Hard cap on tokens in a sub-agent report returned to the parent. */
  subAgentReportTokenCap: number;
  /** Sampling temperature for planning/execution calls. */
  temperature: number;
  /** Max persistent memory items; over budget, lowest-value retrievable items are evicted (Iteration 20). */
  memoryBudget: number;
  /** Half-life of the memory recency curve, in ms (Iteration 20). */
  memoryHalfLifeMs: number;
  /**
   * Importance threshold for promoting short-term memories to long-term at task
   * end (Iteration 21 rule, parameterised in Iteration 22). Default 0.6 — the
   * exact behaviour shipped in Iteration 21.
   */
  promoteShortTermThreshold: number;
  /**
   * `always` stops in `awaiting-approval` until a person approves the plan.
   * `auto` passes the gate without waiting. Default is `always`.
   */
  planApproval: 'always' | 'auto';
  /**
   * USD ceiling for one task. `0` means no ceiling. Once the estimate reaches
   * it, later attempts stay on the grunt model instead of failing the task.
   */
  maxCostPerTask: number;
  /**
   * Directory holding per-workspace project profiles (`<name>.yaml`, Iteration 24).
   * When set, the planner reads the profile for the current workspace before
   * planning and feeds conventions / pitfalls / verification / forbidden into the
   * plan prompt. `undefined` keeps the planner profile-free (the pre-24 behaviour).
   */
  profileDir?: string;
  /**
   * Directory where a per-task run record is written (`<taskId>/record.json`,
   * Iteration 24). When set, the loop writes model / prompts / context snapshot /
   * tool results at task end so the run is replayable offline. `undefined` keeps
   * the loop record-free (the pre-24 behaviour).
   */
  runRecordDir?: string;
  /**
   * Prediction–error loop (ARCH-COGNITION §7.4). Default `observe`: when the
   * port is injected, record predictions and residuals and do not change a
   * plan, a model choice, or a tool call. `off` skips the port. `advise` and
   * `drive` are stored but not acted on until Phase 4.
   */
  cognitionMode: CognitionMode;
  /** Residuals below this sample count never set surprise. */
  cognitionMinSamples: number;
  /** Percentile of the recent residual window used as the surprise threshold. */
  cognitionSurprisePercentile: number;
  /** Samples a backoff level needs before its estimate is used. */
  cognitionLevelSamples: number;
  /** Read-only probes allowed per task once `drive` exists. Unused in Phase 2. */
  cognitionMaxProbesPerTask: number;
}

export const defaultApprovalPolicy: ApprovalPolicy = {
  byRisk: {
    'read-only': 'auto',
    write: 'auto',
    destructive: 'ask',
    network: 'ask',
    privileged: 'ask',
  },
  deniedPaths: ['.git/', 'node_modules/', '.env', '.env.local'],
  deniedCommands: ['rm -rf /', 'format ', 'mkfs', 'del /f /s /q c:\\', 'shutdown'],
  rememberSessionApprovals: true,
};

export const defaultHarnessConfig: HarnessConfig = {
  maxSteps: 24,
  maxIterationsPerStep: 8,
  maxToolCallsPerStep: 12,
  toolTimeoutMs: 30_000,
  shellTimeoutMs: 60_000,
  contextWindow: 128_000,
  softLimitRatio: 0.8,
  driftThreshold: 0.45,
  loopRepeatThreshold: 3,
  noProgressThreshold: 3,
  maxRetries: 3,
  maxSubAgents: 3,
  plannerMode: 'auto',
  approval: defaultApprovalPolicy,
  subAgentReportTokenCap: 1_200,
  temperature: 0,
  memoryBudget: 200,
  memoryHalfLifeMs: 30 * 24 * 60 * 60 * 1000,
  promoteShortTermThreshold: 0.6,
  planApproval: 'always',
  maxCostPerTask: 0,
  cognitionMode: 'observe',
  cognitionMinSamples: 8,
  cognitionSurprisePercentile: 80,
  cognitionLevelSamples: 3,
  cognitionMaxProbesPerTask: 2,
};

/** Shallow-merge a partial config over the defaults, keeping nested approval policy intact. */
export function resolveConfig(partial: Partial<HarnessConfig> = {}): HarnessConfig {
  const approval = partial.approval
    ? {
        ...defaultApprovalPolicy,
        ...partial.approval,
        byRisk: { ...defaultApprovalPolicy.byRisk, ...(partial.approval.byRisk ?? {}) },
        deniedPaths: partial.approval.deniedPaths ?? defaultApprovalPolicy.deniedPaths,
        deniedCommands: partial.approval.deniedCommands ?? defaultApprovalPolicy.deniedCommands,
      }
    : defaultApprovalPolicy;
  return { ...defaultHarnessConfig, ...partial, approval };
}