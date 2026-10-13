/**
 * Event and command contracts — the only sanctioned way to communicate across layers.
 *
 * Rationale (whitepaper §2.3): making every cross-layer interaction an event gives us
 * traceability, replayability, testability and non-blocking streaming for free.
 * @module
 */

import type { Id, JsonValue, Timestamp } from './common.js';
import type {
  Artifact,
  Checkpoint,
  ClarifiedIntent,
  MemoryLayer,
  MessageRole,
  Plan,
  ProviderCapabilities,
  Step,
  StepResult,
  SubAgentReport,
  Task,
  TaskPhase,
  TaskStatus,
  ToolCall,
  TokenBudget,
  Verdict,
} from './domain.js';

/**
 * A bounded, user-inspectable copy of one message that compaction removed.
 *
 * The UI promises that compressed content stays *inspectable* (whitepaper §6.1), not
 * merely summarised. Carrying the original bytes on the event — rather than a side
 * channel — keeps the projection a pure fold: a replay shows the same dropped text.
 * `content` is capped so a single giant tool output cannot bloat the browser snapshot.
 */
export interface DroppedMessage {
  role: MessageRole;
  /** Tool name, present for `role: 'tool'`. */
  name?: string;
  /** The original content, truncated to a bounded length. */
  content: string;
  /** True when `content` was truncated to fit the cap. */
  truncated: boolean;
}

/**
 * Tool-use posture for the chat path (对话 mode), chosen by the user per session.
 *
 * The default is deliberately the most restrictive: a chat that reads the
 * workspace and *explains* what it would need for anything else is useful and
 * safe out of the box; broader postures are an explicit user decision.
 * - `readonly-sandbox` — read tools run; write/exec/network tools are denied
 *   (the denial is fed back to the model so it can say so in plain language).
 * - `ask` — read tools run; everything else opens the usual approval gate.
 * - `full` — everything runs directly.
 */
export type ChatPolicy = 'readonly-sandbox' | 'ask' | 'full';

/** Envelope shared by every event travelling through the bus. */
export interface EventEnvelope<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
  traceId: string;
  sessionId?: Id;
  taskId?: Id;
  ts: Timestamp;
  /** Monotonic sequence within a session, assigned by the store. */
  seq?: number;
}

/** Map of every domain event to its payload. Adding an event here is the only way to add one. */
export interface DomainEventMap {
  // ---- Task lifecycle -------------------------------------------------------
  'task.received': { task: Task };
  'task.clarified': { intent: ClarifiedIntent };
  'task.status_changed': { from: TaskStatus; to: TaskStatus; reason: string };
  'task.phase_changed': { phase: TaskPhase };
  'task.progress': { progress: number; currentStepIdx: number; totalSteps: number };
  'task.paused': { reason: string };
  'task.resumed': { fromStatus: TaskStatus };
  'task.intervened': { instruction: string; previousGoal: string; newGoal: string };
  'task.completed': { summary: string; artifacts: Artifact[] };
  'task.failed': { reason: string; recoverable: boolean };
  'task.cancelled': { reason: string };

  // ---- Planning -------------------------------------------------------------
  'plan.started': { mode: 'fast' | 'full' };
  'plan.ready': { plan: Plan };
  'plan.revised': { previousRevision: number; plan: Plan; reason: string };
  'plan.failed': { reason: string };

  // ---- Steps ----------------------------------------------------------------
  'step.started': { step: Step };
  'routing.chosen': { stepId: Id; model: string; line: string; estimatedUsd: number; tokens: number };
  'step.completed': { step: Step; result: StepResult; score: number };
  'step.failed': { step: Step; error: string; score: number };
  'step.skipped': { step: Step; reason: string };

  // ---- Tools ----------------------------------------------------------------
  'tool.requested': { call: ToolCall };
  'tool.approval_required': { call: ToolCall };
  'tool.approved': { callId: Id; by: 'policy' | 'user' };
  'tool.denied': { callId: Id; reason: string };
  'tool.started': { callId: Id; name: string };
  'tool.finished': { call: ToolCall };
  'tool.failed': { callId: Id; name: string; error: string; recoverable: boolean };

  // ---- Verification ---------------------------------------------------------
  'verify.started': { stepId: Id; points: number };
  'verify.result': { verdict: Verdict };
  'verify.fix_required': { stepId: Id; verdicts: Verdict[] };

  // ---- Context --------------------------------------------------------------
  'context.budget': { budget: TokenBudget };
  'context.compaction_started': { tokensBefore: number; reason: 'soft-limit' | 'hard-limit' };
  'context.compacted': {
    tokensBefore: number;
    tokensAfter: number;
    droppedMessages: number;
    /** Summaries of what was compressed away — user-visible. */
    summaries: string[];
    /** Bounded originals of the dropped messages, so the user can inspect the raw text. */
    droppedPreviews: DroppedMessage[];
    /** Protected slots that survived compaction (goal/constraints/todos/artifacts). */
    protectedSlots: string[];
  };
  'context.deduplicated': { removed: number };

  // ---- Reliability ----------------------------------------------------------
  'reliability.drift_detected': { score: number; signals: string[]; action: string };
  'reliability.loop_detected': { fingerprint: string; repeats: number; action: string };
  'reliability.hallucination_blocked': { claim: string; reason: string };
  'reliability.no_progress': { streak: number; action: string };

  // ---- Recovery -------------------------------------------------------------
  'recovery.classified': { errorClass: string; message: string };
  'recovery.attempted': { strategy: string; attempt: number };
  'recovery.succeeded': { strategy: string; attempts: number };
  'recovery.failed': { strategy: string; attempts: number; error: string };
  'recovery.rollback_started': { checkpointId: Id };
  'recovery.rollback_done': { checkpointId: Id; restored: number };

  // ---- Sub-agents -----------------------------------------------------------
  'subagent.spawned': { id: Id; goal: string; parentTaskId: Id };
  'subagent.finished': { report: SubAgentReport };

  // ---- Providers ------------------------------------------------------------
  'provider.selected': { providerId: string; model: string; reason: string };
  'provider.fallback': { from: string; to: string; reason: string; depth: number };
  'provider.capabilities': { providerId: string; capabilities: ProviderCapabilities };

  // ---- Persistence ----------------------------------------------------------
  'checkpoint.created': { checkpoint: Checkpoint };
  'memory.written': { count: number; kind: string; contentSnippet: string };

  // ---- Self-review (Iteration 20 — "think before acting") ------------------
  'selfreview.performed': {
    decisionPoint: 'planning' | 'verification-fail' | 'reflect';
    verdict: 'approve' | 'revise';
    mode: 'fast' | 'full';
    planId: Id;
    questions: { id: string; status: 'pass' | 'warn' | 'fail'; detail: string }[];
  };
  'selfreview.skipped': { decisionPoint: string; reason: string };

  // ---- Memory lifecycle (Iteration 20 — value-driven forgetting) -----------
  'memory.recalled': {
    count: number;
    ids: Id[];
    noise: number;
    /** Which memory was hit, from which layer, and why (Iteration 21). */
    provenance: { memoryId: Id; layer: string; matchedBy: string }[];
  };
  'memory.forgotten': { memoryId: Id; contentSnippet: string; reason: string; value: number };
  'memory.reactivated': { memoryId: Id; nextReviewAt: number };
  /**
   * A memory-informed decision was disproved: the item is marked known-bad
   * (correctness → 0) and stops being recalled until evidence clears it
   * (Iteration 21 — the correction channel for memory pollution).
   */
  'memory.downgraded': { memoryId: Id; reason: string; correctness: number };
  /**
   * A memory was promoted short-term → long-term, either by the session-lifecycle
   * rule (`promoteShortTerm`) or by an explicit user action from the memory panel
   * (`promoteMemory`, Iteration 22).
   */
  'memory.promoted': { memoryId: Id; layer: 'long'; reason: string };
  'memory.critiqued': { discounted: number; kept: number };

  // ---- Tools (Iteration 20 — three-layer tool knowledge) -------------------
  'tool.usage_injected': { name: string; chars: number };

  // ---- Chat (direct conversation path — no task state machine) --------------
  /**
   * The chat path has its own event family, deliberately parallel to (not inside)
   * the task lifecycle: a chat turn never creates a task, so plan machinery
   * (clarify → plan → gate → verify) cannot leak into a plain conversation.
   * Every event carries `turnId`; the projection folds them into `snapshot.chat`.
   */
  'chat.received': { turnId: Id; text: string };
  'chat.delta': { turnId: Id; delta: string };
  'chat.message': { turnId: Id; role: 'user' | 'assistant'; text: string };
  /** Tool-call progress for a chat turn. Emitted at every status transition. */
  'chat.tool': { call: ToolCall };
  /** The model asked the user a question with fixed options; UI renders a picker. */
  'chat.ask_user': { askId: Id; question: string; options: string[] };
  /** The user picked an option; the turn resumes. The option text becomes a user turn. */
  'chat.answered': { askId: Id; optionIdx: number };
  'chat.failed': { turnId: Id; error: string };
  'chat.policy_changed': { policy: ChatPolicy };

  // ---- Observability passthrough -------------------------------------------
  'log': { level: 'debug' | 'info' | 'warn' | 'error'; message: string; meta?: JsonValue };
  'metric': { name: string; value: number; tags?: Record<string, string> };
}

export type DomainEventType = keyof DomainEventMap;

export type DomainEventOf<T extends DomainEventType> = EventEnvelope<T, DomainEventMap[T]>;

/** Discriminated union of all domain events. */
export type DomainEvent = {
  [K in DomainEventType]: DomainEventOf<K>;
}[DomainEventType];

/** Untyped envelope used when persisting/replaying arbitrary events. */
export interface StoredEvent {
  type: string;
  payload: unknown;
  traceId: string;
  sessionId?: Id;
  taskId?: Id;
  ts: number;
  seq: number;
}

// ---------------------------------------------------------------------------
// Commands: ui -> agent (intent). Downward direction.
// ---------------------------------------------------------------------------

/** A user edit applied to a plan that is waiting for approval. */
export type PlanEdit =
  | { op: 'retitle'; stepId: Id; title: string }
  | { op: 'repath'; stepId: Id; path: string }
  | { op: 'delete'; stepId: Id }
  | { op: 'reorder'; stepIds: Id[] }
  | { op: 'insert'; afterStepId?: Id; title: string; path?: string };

export interface CommandMap {
  'submit_task': { sessionId: Id; intent: string; workspace: string };
  'approve_tool': { callId: Id; scope: 'once' | 'session' };
  'deny_tool': { callId: Id; reason: string };
  /** `session` auto-approves later plans in this project, same shape as `approve_tool`. */
  'approve_plan': { taskId: Id; scope: 'once' | 'session' };
  'reject_plan': { taskId: Id; reason: string };
  'edit_plan': { taskId: Id; edits: PlanEdit[] };
  'set_plan_approval': { mode: 'always' | 'auto' };
  'pause_task': { taskId: Id; reason: string };
  'resume_task': { taskId: Id };
  'cancel_task': { taskId: Id; reason: string };
  'intervene_goal': { taskId: Id; instruction: string };
  'rollback_step': { taskId: Id; checkpointId: Id };
  'select_provider': { providerId: string; model?: string };

  // ---- Session switching (P0) ------------------------------------------
  /** Create a fresh session row. Response data: `{ sessionId: Id }`. */
  'new_session': Record<string, never>;
  /** Ask the UI to re-attach to a prior session's event stream. */
  'select_session': { sessionId: Id };

  // ---- Memory panel (Iteration 22 — visible · usable · tunable) -----------
  /**
   * List memories, optionally filtered by layer and/or to one session.
   *
   * `sessionId` restricts the result to memories *learned in that session*
   * (`scope = 'session' AND session_id = ?`). It deliberately does **not**
   * OR-in `scope = 'global'` the way the recall-path query does: the panel
   * answers "what did this task learn?", and cross-session memories are a
   * different question with a different home (Settings). Response data:
   * `MemoryView[]`.
   */
  'list_memories': { layer?: MemoryLayer; sessionId?: Id };
  /** Read one memory. Response data: `MemoryView | null`. */
  'get_memory': { memoryId: Id };
  /** Audit trail of every forgetting decision. Response data: `ForgetLogView[]`. */
  'list_forget_log': { limit?: number };
  /** High-value memories due for spaced-repetition reactivation. Response data: `MemoryView[]`. */
  'list_reactivation_due': { limit?: number };
  /**
   * Mark a memory known-bad (correctness → 0, exits recall/reactivation).
   * Emits `memory.downgraded`.
   */
  'mark_memory_incorrect': { memoryId: Id; reason: string };
  /** Forget one memory with an audit-trail entry. Emits `memory.forgotten`. */
  'forget_memory': { memoryId: Id; reason: string };
  /** Promote one short-term memory to long-term. Emits `memory.promoted`. */
  'promote_memory': { memoryId: Id };
  /** Memory-health snapshot (cross-session recall-noise rate, layer counts). Response data: `MemoryHealthView`. */
  'get_memory_health': Record<string, never>;
  /**
   * Recall timeline (Iteration 26): persisted `memory.recalled` hits, one entry
   * per hit, with the hit's layer, content snippet, matchedBy (via), noise, and
   * whether that memory was later judged incorrect / downgraded. All filters are
   * optional; response data is `MemoryRecallView[]`, ascending by time.
   */
  'list_recall_history': { memoryId?: Id; sessionId?: Id; since?: number; limit?: number };

  // ---- Chat (direct conversation path) -------------------------------------
  /** Send one chat turn. Rejected while a task run is active (see EngineServer). */
  'chat_message': { sessionId: Id; text: string; policy: ChatPolicy };
  /** Answer a pending `chat.ask_user` picker. */
  'chat_answer': { sessionId: Id; askId: Id; optionIdx: number };
  /** Abort the in-flight chat turn (and clear any pending ask). */
  'chat_cancel': { sessionId: Id };
}

export type CommandType = keyof CommandMap;

export type Command<T extends CommandType = CommandType> = {
  [K in CommandType]: EventEnvelope<K, CommandMap[K]> & { commandId: Id };
}[T];