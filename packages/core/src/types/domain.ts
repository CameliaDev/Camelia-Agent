/**
 * Domain entities. Mirrors the SQLite schema in `persistence/schema.ts`
 * and chapter 7 of the whitepaper.
 * @module
 */

import type { Id, JsonObject, JsonSchema, JsonValue, Timestamp } from './common.js';

/** Lifecycle status of a task. Drives the TaskStateMachine. */
export type TaskStatus =
  | 'received'
  | 'clarifying'
  | 'planning'
  | 'awaiting-approval'
  | 'executing'
  | 'verifying'
  | 'delivering'
  | 'reflecting'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

/**
 * Coarse phase projected to the UI ("what is the agent doing right now").
 *
 * A status is promoted to its own phase only when both are true: leaving it
 * needs an outside actor, and the UI must show a different center view.
 * `awaiting-approval` and `paused` qualify. Clarifying stays inside `planning`.
 */
export type TaskPhase = 'idle' | 'planning' | 'awaiting-approval' | 'executing' | 'verifying' | 'delivering' | 'paused';

export type StepStatus = 'pending' | 'running' | 'verifying' | 'done' | 'failed' | 'skipped';

export type VerdictStatus = 'pass' | 'fail' | 'unknown';

/**
 * Risk classification of a tool call. Drives ApprovalGate policy.
 * - `read-only`   — safe, auto-approved
 * - `write`       — mutates workspace, configurable
 * - `destructive` — deletes/overwrites broadly, requires approval by default
 * - `network`     — outbound traffic, configurable
 * - `privileged`  — shell / system level, always requires approval
 */
export type RiskLevel = 'read-only' | 'write' | 'destructive' | 'network' | 'privileged';

export type ToolCallStatus =
  | 'pending'
  | 'awaiting-approval'
  | 'approved'
  | 'denied'
  | 'running'
  | 'ok'
  | 'error';

export type SessionKind = 'work' | 'math' | 'term';

export interface Session {
  id: Id;
  title: string;
  workspace: string;
  provider: string;
  model: string;
  /** Work | Math list partition (F6). Absent rows backfill to work. */
  kind: SessionKind;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** The user's intent after the Clarify stage. */
export interface ClarifiedIntent {
  /** Restated goal in one sentence. */
  goal: string;
  /** Assumptions made because the user did not specify. */
  assumptions: string[];
  /** Constraints discovered or stated (e.g. "do not touch tests"). */
  constraints: string[];
  /** Files/dirs the task is expected to touch (may be empty). */
  expectedPaths: string[];
  /** Whether clarification is considered complete. */
  complete: boolean;
}

/** A single acceptance point attached to a step. */
export interface AcceptancePoint {
  id: Id;
  /** Human readable description. */
  description: string;
  /** Machine-checkable kind. */
  kind: 'file-exists' | 'file-contains' | 'command-exit-zero' | 'test-pass' | 'diff-nonempty' | 'manual';
  /** Kind-specific parameters (e.g. `{ path, pattern }`). */
  params: JsonObject;
}

export interface Plan {
  id: Id;
  taskId: Id;
  /** Ordered steps. Dependencies expressed via `Step.deps`. */
  steps: Step[];
  /** Planner mode that produced this plan. */
  mode: 'fast' | 'full';
  revision: number;
  createdAt: Timestamp;
}

export interface Step {
  id: Id;
  taskId: Id;
  idx: number;
  title: string;
  /** What the executor is asked to achieve (natural language). */
  goal: string;
  status: StepStatus;
  acceptance: AcceptancePoint[];
  /** Progress weight; defaults to 1. */
  weight: number;
  /** Ids of steps that must complete first. */
  deps: Id[];
  startedAt?: Timestamp;
  endedAt?: Timestamp;
}

export interface ToolCall {
  id: Id;
  stepId: Id;
  taskId: Id;
  name: string;
  input: JsonValue;
  output?: JsonValue;
  status: ToolCallStatus;
  risk: RiskLevel;
  reversible: boolean;
  durationMs?: number;
  error?: string;
  traceId: string;
  createdAt: Timestamp;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  id: Id;
  taskId: Id;
  role: MessageRole;
  content: string;
  /** Name of the tool for `role: 'tool'`. */
  name?: string;
  tokens: number;
  /** True when this message has been replaced by a summary. */
  compacted: boolean;
  createdAt: Timestamp;
}

export interface Evidence {
  kind: 'tool-call' | 'command-output' | 'file-hash' | 'assertion' | 'model-claim';
  /** Reference to the artifact proving the claim (tool call id, path, hash...). */
  ref: string;
  detail?: string;
}

export interface Verdict {
  id: Id;
  stepId: Id;
  taskId: Id;
  status: VerdictStatus;
  evidence: Evidence[];
  reason: string;
  createdAt: Timestamp;
}

export interface StepResult {
  stepId: Id;
  status: 'ok' | 'error';
  toolCalls: ToolCall[];
  /** Free-form summary of what happened (for the next model call). */
  summary: string;
  artifacts: Artifact[];
  error?: string;
}

export interface Artifact {
  kind: 'file' | 'diff' | 'stdout' | 'report';
  /** Workspace-relative path or synthetic name. */
  path: string;
  /** Content hash for change detection / rollback. */
  hash?: string;
  sizeBytes?: number;
}

/** Filesystem manifest captured at a checkpoint, used for rollback. */
export interface FsManifest {
  /** path -> content hash */
  entries: Record<string, string>;
}

export interface Checkpoint {
  id: Id;
  taskId: Id;
  stepIdx: number;
  ctxSummary: string;
  fsManifest: FsManifest;
  createdAt: Timestamp;
}

export type MemoryKind = 'fact' | 'lesson' | 'preference' | 'artifact' | 'procedural';

/**
 * Memory layers (Iteration 20 — human-like memory lifecycle).
 *
 * - `working`   — current-task, strongly retained in-context (protected slots).
 * - `short`     — within-session facts (`scope === 'session'`).
 * - `long`      — cross-session facts (`scope === 'global'`).
 * - `procedural`— "when I hit problem X I do Y" recipes, escalated by reflection.
 */
export type MemoryLayer = 'working' | 'short' | 'long' | 'procedural';

/**
 * Evidence that a memory was validated by a task outcome (Iteration 22).
 *
 * `markCorrect` records *which* verification passed: the task id and the verdict
 * that closed the loop. The evidence is the audit trail behind the correctness
 * boost — the panel shows "validated by task tsk_… (pass)" instead of an
 * unexplained 1.0.
 */
export interface MemoryEvidence {
  taskId: Id;
  verdict: 'pass' | 'unknown';
  at: Timestamp;
  /** Optional short note about what passed (e.g. the verified outcome summary). */
  detail?: string;
}

export interface MemoryItem {
  id: Id;
  scope: 'global' | 'session';
  sessionId?: Id;
  kind: MemoryKind;
  content: string;
  keywords: string;
  /** 0..1 recall strength — recomputed as value (importance × recency × correctness). */
  strength?: number;
  /** 0..1 intrinsic importance of the memory. */
  importance?: number;
  /** Epoch ms of the last successful recall/use. */
  lastHitAt?: number;
  /** Expiry in ms; null/absent = no time-based expiry. */
  ttl?: number | null;
  /** Number of successful recalls. */
  hits?: number;
  /** Next scheduled reactivation (spaced-repetition heuristic). */
  nextReviewAt?: number | null;
  /**
   * False = never mechanically evicted (lessons, constraints, project facts are
   * not re-fetchable). True = safe to unload under budget pressure.
   */
  retrievable?: boolean;
  /** 0..1 validated correctness — raised when a memory-informed action succeeds. */
  correctness?: number;
  /** Memory layer this item lives in. */
  layer?: MemoryLayer;
  /** What verification closed the correctness loop (Iteration 22). */
  evidence?: MemoryEvidence | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Audit trail entry for every forgetting decision (Iteration 20). */
export interface ForgetLogEntry {
  id: Id;
  memoryId: Id;
  /** Bounded snippet of what was forgotten — enough to audit, no full payload. */
  contentSnippet: string;
  /** Why it was forgotten (e.g. `budget-eviction`, `manual`). */
  reason: string;
  /** Value score at the moment of forgetting. */
  value: number;
  createdAt: Timestamp;
}

/** Structured report returned by a sub-agent. Deliberately small. */
export interface SubAgentReport {
  id: Id;
  parentTaskId: Id;
  goal: string;
  status: 'ok' | 'error';
  summary: string;
  artifacts: Artifact[];
  verdicts: Verdict[];
  tokensUsed: number;
  startedAt: Timestamp;
  endedAt: Timestamp;
}

export interface Task {
  id: Id;
  sessionId: Id;
  intentRaw: string;
  intentClarified?: ClarifiedIntent;
  status: TaskStatus;
  phase: TaskPhase;
  plan?: Plan;
  progress: number;
  /** Set when status === 'paused', to know where to resume. */
  resumeTarget?: TaskStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Token accounting for the context window. */
export interface TokenBudget {
  /** Model context window size. */
  window: number;
  /** Soft limit triggering compaction (e.g. 0.8 * window). */
  softLimit: number;
  /** Currently used tokens. */
  used: number;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  schema: JsonSchema;
  risk: RiskLevel;
  reversible: boolean;
  /** Source of the tool: builtin, plugin id, or mcp server name. */
  source: string;
}

export interface ModelInfo {
  id: string;
  providerId: string;
  /** Free-text label. */
  label: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsJson: boolean;
  /** True when the model accepts image / multimodal parts. */
  supportsVision: boolean;
}

/** Capability profile of a provider — drives granularity + fallback decisions. */
export interface ProviderCapabilities {
  supportsTools: boolean;
  /**
   * True when the provider accepts a `tools` parameter but does **not** return
   * structured tool calls, so calls must be written as text and recovered.
   *
   * Measured: `qwen2.5-coder:7b` behind Ollama 0.40.2 understands the offered
   * tools perfectly but answers with prose or a JSON code block, leaving
   * `tool_calls` empty. The distinction matters because the two cases need
   * opposite prompts — one needs the tool list spelled out and a format to
   * follow, the other needs no such instruction.
   */
  textToolCalls?: boolean;
  supportsJson: boolean;
  supportsStreaming: boolean;
  maxContextWindow: number;
  /** True when models on this provider generally accept images. Overridable per model. */
  supportsVision?: boolean;
  /** 0..1 heuristic quality score used by ModelRouter. */
  quality: number;
}