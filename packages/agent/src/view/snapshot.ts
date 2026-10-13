/**
 * Task-state projection: the contract between the engine's event stream and the UI.
 *
 * The UI never invents business state (whitepaper §6.1) — it renders a snapshot that
 * is a *pure fold* of domain events. Keeping that fold here, in `agent`, matches its
 * charter ("事件→状态翻译", §2.2) and lets the webview consume it without pulling in
 * any Node-only code.
 *
 * This module has no runtime dependencies: type-only imports from `@camelia/core`,
 * no `node:` imports, no I/O. That is precisely what lets `@camelia/ui` import it
 * across the layer boundary (`ui → agent`) without violating the dependency rule.
 * @module
 */

import type {
  Artifact,
  ChatImagePayload,
  ChatPolicy,
  DomainEvent,
  DroppedMessage,
  Id,
  JsonValue,
  MemoryEvidence,
  MemoryItem,
  MemoryKind,
  MemoryLayer,
  RiskLevel,
  StepStatus,
  TaskPhase,
  TaskStatus,
  ToolCall,
  ToolCallStatus,
  VerdictStatus,
} from '@camelia/core';

import type { ProviderStatus } from './wire.js';

/** Bounded so a pathological event storm cannot grow the browser snapshot forever. */
const MAX_TIMELINE = 400;
const MAX_NOTICES = 50;

export type ApprovalState = 'none' | 'required' | 'approved' | 'denied';

/** A step as the UI needs it: identity, live status, and its verdict. */
export interface StepView {
  id: Id;
  idx: number;
  title: string;
  goal: string;
  status: StepStatus;
  weight: number;
  acceptance: { description: string; kind: string; path?: string }[];
  /** Ids of steps that must complete first. Absent on older projections. */
  deps?: Id[];
  startedAt?: number;
  endedAt?: number;
  verdict?: { status: VerdictStatus; reason: string };
  /** Why the step failed, when it did. */
  error?: string;
}

/** A tool call with everything the UI must expose: input, output, duration, approval. */
export interface ToolCallView {
  id: Id;
  /** Owning step — lets the conversation nest calls under the step that made them. */
  stepId: Id;
  taskId: Id;
  name: string;
  risk: RiskLevel;
  reversible: boolean;
  status: ToolCallStatus;
  input: JsonValue;
  output?: JsonValue;
  durationMs?: number;
  error?: string;
  approval: ApprovalState;
  at: number;
}

export interface CompactionView {
  tokensBefore: number;
  tokensAfter: number;
  droppedMessages: number;
  /** Human-readable summaries of what was compressed away — inspectable. */
  summaries: string[];
  /** Bounded originals of the dropped messages, so the raw text stays inspectable. */
  droppedPreviews: DroppedMessage[];
  /** Protected slots that survived (goal/constraints/todos/artifacts). */
  protectedSlots: string[];
  at: number;
}

export interface ContextView {
  window: number;
  softLimit: number;
  used: number;
  compactions: CompactionView[];
  deduplicated: number;
}

export interface SubAgentView {
  id: Id;
  goal: string;
  status: 'running' | 'ok' | 'error';
  summary?: string;
  tokensUsed?: number;
  artifacts: Artifact[];
  startedAt: number;
  endedAt?: number;
}

export interface FailureView {
  reason: string;
  recoverable: boolean;
  errorClass?: string;
  attempts: number;
  strategy?: string;
  /** Suggested next action surfaced to the user (retry / degrade / rollback). */
  suggestion: string;
  at: number;
}

export interface ApprovalView {
  callId: Id;
  name: string;
  risk: RiskLevel;
  input: JsonValue;
  at: number;
}

export interface NoticeView {
  kind: 'drift' | 'loop' | 'hallucination' | 'no-progress' | 'rollback';
  title: string;
  detail: string;
  action: string;
  at: number;
}

/**
 * One chat turn — a user message or an assistant reply on the direct chat path.
 *
 * Tool calls made during the turn are folded inline (the UI renders them with the
 * same `ToolCard` the task view uses), so a chat that reads a file shows *what it
 * did* next to *what it said*, exactly like the task transcript does.
 */
export interface ChatTurnView {
  id: Id;
  role: 'user' | 'assistant';
  text: string;
  /** Pasted images on this user turn (base64 payload from chat.received). */
  images?: ChatImagePayload[];
  /** True while `chat.delta` chunks are still arriving (drives the caret). */
  streaming: boolean;
  toolCalls: ToolCallView[];
  /** Why the turn ended abnormally, when it did (`chat.failed`). */
  error?: string;
  at: number;
}

/** A `chat.ask_user` the user has not answered yet. */
export interface PendingAskView {
  askId: Id;
  question: string;
  options: string[];
  at: number;
}

/** The chat path's projection — parallel to `task`, never inside it. */
export interface ChatView {
  turns: ChatTurnView[];
  pendingAsk?: PendingAskView;
  /** The posture new turns are sent with; mirrored back via `chat.policy_changed`. */
  policy: ChatPolicy;
}

/**
 * Assistant narration streamed from the model, grouped per step.
 *
 * The engine emits each streamed chunk as a `log` event with `meta.stream = true`
 * (`ModelGateway`). Folding those chunks into one entry per step is what lets the
 * conversation column show the agent *reasoning*, not just its tool calls — while
 * keeping the projection a pure, deterministic fold.
 */
export interface NarrationView {
  id: string;
  stepIdx: number;
  text: string;
  at: number;
  /** True while chunks are still arriving (drives the caret animation). */
  streaming: boolean;
}

export interface ProviderView {
  activeProvider?: string;
  activeModel?: string;
  /**
   * Models the active provider advertises. The composer offers these for in-place
   * switching; absent (rather than empty) when the provider advertises none, so the UI
   * can tell "no choice to offer" from "not yet known".
   */
  models?: string[];
  /**
   * Which provider the `models` list belongs to.
   *
   * A run's events can re-route the provider after bootstrap, so the list is only usable
   * when this matches `activeProvider`. Tagging the list beats clearing it on every write:
   * there is one place to get it right, and a reader that forgets the check fails visibly
   * (no dropdown) rather than offering another vendor's models.
   */
  modelsFor?: string;
  /** Set when the active provider was chosen for a stated reason. */
  reason?: string;
  fallbacks: { from: string; to: string; reason: string; depth: number; at: number }[];
  /**
   * Whether the engine resolved a working provider (from `GET /health` / the bootstrap
   * frame). `undefined` means *not yet known* — distinct from `false`, which means the
   * engine answered and has no provider. The UI must not collapse the two, or a booting
   * engine would look like a broken one.
   */
  connected?: boolean;
  /** Every provider on the configured fallback chain, in order. */
  chain?: string[];
}

export interface CheckpointView {
  id: Id;
  stepIdx: number;
  ctxSummary: string;
  at: number;
}

export type ActivityKind = 'idle' | 'planning' | 'executing' | 'verifying' | 'delivering' | 'waiting-approval';

/** "What is the agent doing right now" — the single most important UI projection. */
export interface ActivityView {
  kind: ActivityKind;
  detail: string;
  since: number;
}

export interface TaskView {
  id: Id;
  sessionId: Id;
  intentRaw: string;
  goal?: string;
  assumptions: string[];
  constraints: string[];
  status: TaskStatus;
  phase: TaskPhase;
  /** 0..1, weighted by step weight. */
  progress: number;
  currentStepIdx: number;
  stepsTotal: number;
  steps: StepView[];
  toolCalls: Record<Id, ToolCallView>;
  context: ContextView;
  subAgents: SubAgentView[];
  failures: FailureView[];
  approvals: ApprovalView[];
  notices: NoticeView[];
  narration: NarrationView[];
  checkpoints: CheckpointView[];
  artifacts: Artifact[];
  summary?: string;
  pausedReason?: string;
  /** Goal changes the user made mid-flight, most recent last. */
  interventions: { instruction: string; previousGoal: string; newGoal: string; at: number }[];
  activity: ActivityView;
  /** Last cheap-first routing line for this task, when the loop emitted one. */
  routing?: { line: string; estimatedUsd: number; tokens: number; model: string };
  startedAt: number;
  updatedAt: number;
}

export interface SessionView {
  id: Id;
  title: string;
  workspace: string;
  provider: string;
  model: string;
  /** Work | Math list partition. Absent rows backfill to work. */
  kind?: 'work' | 'math' | 'term';
  /**
   * True when the session has never held a task or event — the row 「新建」
   * should reuse rather than stack another blank.
   */
  blank?: boolean;
}

/**
 * One memory as the panel renders it (Iteration 22).
 *
 * The engine pre-computes the display fields (`strength`, `recency`) so the
 * value formula stays authoritative in the harness; the UI only renders the
 * decomposition `importance × recency × correctness = strength`.
 */
export interface MemoryView {
  id: Id;
  scope: 'global' | 'session';
  sessionId?: Id;
  kind: MemoryKind;
  content: string;
  layer: MemoryLayer;
  strength: number;
  importance: number;
  correctness: number;
  recency: number;
  hits: number;
  lastHitAt?: number;
  nextReviewAt?: number | null;
  retrievable: boolean;
  /** The verification that raised correctness to 1 (markCorrect, Iteration 22). */
  evidence?: MemoryEvidence | null;
  createdAt: number;
  updatedAt: number;
}

/** The forget-log entry as the panel renders it. */
export interface ForgetLogView {
  id: Id;
  memoryId: Id;
  contentSnippet: string;
  reason: string;
  value: number;
  createdAt: number;
}

/** Memory-health snapshot for the panel header (Iteration 22). */
export interface MemoryHealthView {
  totalMemories: number;
  byLayer: Partial<Record<MemoryLayer, number>>;
  /** Cross-session recall-noise aggregate (pollution rate). */
  recallNoise: {
    totalHits: number;
    downgradedHits: number;
    noiseRate: number;
    downgradedMemories: number;
  };
}

/**
 * One persisted recall hit, as the memory panel's timeline shows it
 * (Iteration 26). Structurally identical to the harness's `RecallTimelineHit`;
 * the panel reads it from `list_recall_history` → `EngineServer` →
 * `MemoryService.recallTimeline`, never from the UI's local cache.
 */
export interface MemoryRecallView {
  at: number;
  memoryId: Id;
  layer: MemoryLayer;
  contentSnippet: string;
  matchedBy: string;
  noise: number;
  downgraded: boolean;
}

/**
 * Project a stored memory into the panel view.
 *
 * `scored` carries the live value decomposition from the engine's memory
 * service (`{ strength, recency }`) — the UI never re-derives the formula.
 */
export function toMemoryView(item: MemoryItem, scored: { strength: number; recency: number }): MemoryView {
  return {
    id: item.id,
    scope: item.scope,
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    kind: item.kind,
    content: item.content,
    layer: item.layer ?? (item.scope === 'global' ? 'long' : 'short'),
    strength: scored.strength,
    importance: item.importance ?? 0.5,
    correctness: item.correctness ?? 0.5,
    recency: scored.recency,
    hits: item.hits ?? 0,
    ...(item.lastHitAt !== undefined ? { lastHitAt: item.lastHitAt } : {}),
    ...(item.nextReviewAt !== undefined && item.nextReviewAt !== null ? { nextReviewAt: item.nextReviewAt } : {}),
    retrievable: item.retrievable ?? true,
    ...(item.evidence ? { evidence: item.evidence } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export interface TimelineEntry {
  type: string;
  summary: string;
  at: number;
  traceId: string;
}

export interface ProjectionSnapshot {
  session?: SessionView;
  task?: TaskView;
  /** Direct-conversation path (对话 mode) — independent of `task`. */
  chat: ChatView;
  provider: ProviderView;
  metrics: Record<string, number>;
  /** Raw event trail for the audit / replay drawer. */
  timeline: TimelineEntry[];
}

// ---------------------------------------------------------------------------
// constructors
// ---------------------------------------------------------------------------

export function initialSnapshot(): ProjectionSnapshot {
  return {
    chat: { turns: [], policy: 'readonly-sandbox' },
    provider: { fallbacks: [] },
    metrics: {},
    timeline: [],
  };
}

export function withSession(snapshot: ProjectionSnapshot, session: SessionView): ProjectionSnapshot {
  return { ...snapshot, session };
}

/**
 * Fold the engine's provider-connection state into the snapshot.
 *
 * Kept separate from `reduceEvents` because it does not come from the event stream: the
 * connection state is a property of the engine instance, reported on bootstrap / `/health`.
 * Once a run starts, `provider.selected` carries the same ids and the two agree — this
 * only fills the gap *before* the first task.
 */
export function withProviderStatus(
  snapshot: ProjectionSnapshot,
  status: ProviderStatus | undefined,
): ProjectionSnapshot {
  if (!status) return snapshot;
  const connected = status.state === 'connected';
  return {
    ...snapshot,
    provider: {
      ...snapshot.provider,
      connected,
      chain: status.chain,
      // Tagged with the provider they came from, so a later re-route cannot silently
      // present them under another provider's name.
      ...(status.models?.length ? { models: status.models, modelsFor: status.id } : {}),
      // A known-connected engine that has no session yet should still name its provider;
      // one already set by a run's events wins (it reflects the routing actually taken).
      ...(connected && !snapshot.provider.activeProvider
        ? { activeProvider: status.id, activeModel: status.model }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------

function emptyContext(): ContextView {
  return { window: 0, softLimit: 0, used: 0, compactions: [], deduplicated: 0 };
}

function emptyTask(id: Id, sessionId: Id, intentRaw: string, at: number): TaskView {
  return {
    id,
    sessionId,
    intentRaw,
    assumptions: [],
    constraints: [],
    status: 'received',
    phase: 'idle',
    progress: 0,
    currentStepIdx: -1,
    stepsTotal: 0,
    steps: [],
    toolCalls: {},
    context: emptyContext(),
    subAgents: [],
    failures: [],
    approvals: [],
    notices: [],
    narration: [],
    checkpoints: [],
    artifacts: [],
    interventions: [],
    activity: { kind: 'idle', detail: 'Received the request', since: at },
    startedAt: at,
    updatedAt: at,
  };
}

function acceptanceView(point: { description: string; kind: string; params?: { path?: unknown } }): {
  description: string;
  kind: string;
  path?: string;
} {
  const path = typeof point.params?.path === 'string' ? point.params.path : undefined;
  return path ? { description: point.description, kind: point.kind, path } : { description: point.description, kind: point.kind };
}

function toStepView(step: StepView | undefined, incoming: {
  id: Id; idx: number; title: string; goal: string; status: StepStatus; weight: number;
  acceptance: { description: string; kind: string; path?: string }[];
  deps?: Id[];
  startedAt?: number; endedAt?: number;
}): StepView {
  const view: StepView = {
    id: incoming.id,
    idx: incoming.idx,
    title: incoming.title,
    goal: incoming.goal,
    status: incoming.status,
    weight: incoming.weight,
    acceptance: incoming.acceptance,
    deps: incoming.deps ?? step?.deps ?? [],
    startedAt: incoming.startedAt,
    endedAt: incoming.endedAt,
  };
  // The plan carries *structure*; live status lives in the step events. Preserve the
  // live status when a (re)plan re-states a step that has already run.
  if (step && incoming.status === 'pending') {
    view.status = step.status;
    view.verdict = step.verdict;
    view.error = step.error;
    view.startedAt = step.startedAt;
    view.endedAt = step.endedAt;
  }
  return view;
}

function mergeToolCall(prev: ToolCallView | undefined, call: ToolCall): ToolCallView {
  return {
    id: call.id,
    stepId: call.stepId,
    taskId: call.taskId,
    name: call.name,
    risk: call.risk,
    reversible: call.reversible,
    status: call.status,
    input: call.input,
    output: call.output ?? prev?.output,
    durationMs: call.durationMs ?? prev?.durationMs,
    error: call.error ?? prev?.error,
    approval: prev?.approval ?? 'none',
    at: call.createdAt,
  };
}

function upsertStep(steps: StepView[], step: StepView): StepView[] {
  const next = steps.some((s) => s.id === step.id)
    ? steps.map((s) => (s.id === step.id ? { ...s, ...step } : s))
    : [...steps, step];
  return next.sort((a, b) => a.idx - b.idx);
}

function patchStep(steps: StepView[], id: Id, patch: Partial<StepView>): StepView[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/** Weighted progress so an expensive step moves the bar more than a trivial one. */
export function computeProgress(steps: StepView[]): number {
  const total = steps.reduce((sum, s) => sum + (s.weight || 1), 0);
  if (total === 0) return 0;
  const done = steps
    .filter((s) => s.status === 'done' || s.status === 'skipped')
    .reduce((sum, s) => sum + (s.weight || 1), 0);
  return Math.min(1, done / total);
}

export function contextUsage(ctx: ContextView): number {
  return ctx.window > 0 ? Math.min(1, ctx.used / ctx.window) : 0;
}

// ---------------------------------------------------------------------------
// the fold
// ---------------------------------------------------------------------------

function push<T>(list: T[], item: T, cap = MAX_NOTICES): T[] {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

const MAX_NARRATION = 40;
const MAX_NARRATION_CHARS = 4000;

/** Stop the streaming caret once the model has clearly moved on. */
function closeNarration(narration: NarrationView[]): NarrationView[] {
  const last = narration[narration.length - 1];
  if (!last?.streaming) return narration;
  const next = [...narration];
  next[next.length - 1] = { ...last, streaming: false };
  return next;
}

/** Fold one streamed chunk into the per-step narration buffer. */
function appendNarration(task: TaskView, chunk: string, at: number): NarrationView[] {
  const last = task.narration[task.narration.length - 1];
  if (last && last.streaming && last.stepIdx === task.currentStepIdx) {
    const next = [...task.narration];
    const text = (last.text + chunk).slice(0, MAX_NARRATION_CHARS);
    next[next.length - 1] = { ...last, text, at };
    return next;
  }
  return push(
    task.narration,
    {
      id: `narr-${task.narration.length + 1}`,
      stepIdx: task.currentStepIdx,
      text: chunk.slice(0, MAX_NARRATION_CHARS),
      at,
      streaming: true,
    },
    MAX_NARRATION,
  );
}

function timelineEntry(event: DomainEvent): TimelineEntry {
  return {
    type: event.type,
    summary: summarise(event),
    at: event.ts,
    traceId: event.traceId,
  };
}

/** One-line human summary of an event, for the audit drawer. */
function summarise(event: DomainEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'step.started':
    case 'step.completed':
    case 'step.failed':
    case 'step.skipped':
      return `${(p.step as { title?: string })?.title ?? 'step'}`;
    case 'tool.requested':
    case 'tool.finished':
      return `${(p.call as { name?: string })?.name ?? 'tool'}`;
    case 'tool.failed':
      return `${String(p.name)}: ${String(p.error)}`;
    case 'verify.result':
      return `${(p.verdict as { status?: string })?.status ?? ''} — ${(p.verdict as { reason?: string })?.reason ?? ''}`;
    case 'task.status_changed':
      return `${String(p.from)} → ${String(p.to)}`;
    case 'task.intervened':
      return `goal → ${String(p.newGoal)}`;
    case 'context.compacted':
      return `${String(p.tokensBefore)} → ${String(p.tokensAfter)} tokens`;
    case 'reliability.drift_detected':
      return `drift score ${String(p.score)} (${String(p.action)})`;
    case 'reliability.loop_detected':
      return `repeated ${String(p.repeats)}× (${String(p.action)})`;
    case 'memory.written':
      return `wrote ${String(p.count)} ${String(p.kind)} memory`;
    case 'selfreview.performed':
      return `self-review ${String(p.decisionPoint)} → ${String(p.verdict)}`;
    case 'selfreview.skipped':
      return `self-review ${String(p.decisionPoint)} skipped (${String(p.reason)})`;
    case 'memory.recalled': {
      const provenance = Array.isArray(p.provenance) ? (p.provenance as { layer?: string; matchedBy?: string }[]) : [];
      const layers = provenance.length > 0
        ? ` [${[...new Set(provenance.map((entry) => entry.layer ?? '?'))].join('/')}]`
        : '';
      // "因何命中": the first few matchedBy tokens make the hit explainable in
      // the session timeline (Iteration 22 panel goal). An entry whose matchedBy
      // is empty contributes nothing — and when none survive, no "via" is shown
      // at all (Iteration 26: a bare `via ""` was a display wart).
      const viaTokens = provenance.slice(0, 2).map((entry) => entry.matchedBy ?? '?').filter(Boolean);
      const via = viaTokens.length > 0 ? ` via "${viaTokens.join('", "')}"` : '';
      return `recalled ${String(p.count)}${layers}${via} (noise ${String(p.noise)})`;
    }
    case 'memory.forgotten':
      return `forgot ${String(p.memoryId)} (${String(p.reason)})`;
    case 'memory.reactivated':
      return `reactivate ${String(p.memoryId)}`;
    case 'memory.downgraded':
      return `downgrade ${String(p.memoryId)} (${String(p.reason)})`;
    case 'memory.promoted':
      return `promote ${String(p.memoryId)} → long (${String(p.reason)})`;
    case 'memory.critiqued':
      return `记忆批判: ${String(p.discounted)} 条跨会话降权, ${String(p.kept)} 条保留`;
    case 'tool.usage_injected':
      return `${String(p.name)} usage injected`;
    default:
      return '';
  }
}

function withTimeline(snapshot: ProjectionSnapshot, event: DomainEvent): ProjectionSnapshot {
  const next = [...snapshot.timeline, timelineEntry(event)];
  return {
    ...snapshot,
    timeline: next.length > MAX_TIMELINE ? next.slice(next.length - MAX_TIMELINE) : next,
  };
}

function mutateTask(
  snapshot: ProjectionSnapshot,
  event: DomainEvent,
  patch: (task: TaskView) => TaskView,
): ProjectionSnapshot {
  if (!snapshot.task) return withTimeline(snapshot, event);
  const task = patch(snapshot.task);
  return withTimeline({ ...snapshot, task: { ...task, updatedAt: event.ts } }, event);
}

const MAX_CHAT_TURNS = 80;
const MAX_CHAT_CHARS = 8000;

/** Fold one chat event: patch `snapshot.chat` and keep the audit trail. */
function mutateChat(
  snapshot: ProjectionSnapshot,
  event: DomainEvent,
  patch: (chat: ChatView) => ChatView,
): ProjectionSnapshot {
  return withTimeline({ ...snapshot, chat: patch(snapshot.chat) }, event);
}

/** Upsert a tool call into a turn by id, preserving already-folded output. */
function upsertChatTool(turn: ChatTurnView, call: ToolCall, gate?: boolean): ChatTurnView {
  const prev = turn.toolCalls.find((c) => c.id === call.id);
  const merged = mergeToolCall(prev, call);
  const view: ToolCallView = gate
    ? { ...merged, approval: 'required', status: 'awaiting-approval' }
    : merged;
  const toolCalls = prev
    ? turn.toolCalls.map((c) => (c.id === call.id ? view : c))
    : [...turn.toolCalls, view];
  return { ...turn, toolCalls };
}

/** Append a turn, capping the transcript so a long chat cannot bloat the snapshot. */
function pushChatTurn(chat: ChatView, turn: ChatTurnView): ChatView {
  const next = { ...chat, turns: [...chat.turns, turn] };
  if (next.turns.length > MAX_CHAT_TURNS) next.turns = next.turns.slice(next.turns.length - MAX_CHAT_TURNS);
  return next;
}

/** Fold a streamed chunk into the trailing assistant turn, opening one if needed. */
function appendChatDelta(chat: ChatView, turnId: Id, delta: string, at: number): ChatView {
  const last = chat.turns[chat.turns.length - 1];
  if (last && last.id === turnId && last.role === 'assistant' && last.streaming) {
    const turns = [...chat.turns];
    turns[turns.length - 1] = { ...last, text: (last.text + delta).slice(0, MAX_CHAT_CHARS), at };
    return { ...chat, turns };
  }
  return pushChatTurn(chat, {
    id: turnId,
    role: 'assistant',
    text: delta.slice(0, MAX_CHAT_CHARS),
    streaming: true,
    toolCalls: [],
    at,
  });
}

/**
 * Fold a single domain event into the snapshot, returning a new snapshot.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. Two runs over the same
 * event list produce identical snapshots, which is what makes the UI screenshots
 * reproducible and the projection unit-testable.
 */
export function applyEvent(snapshot: ProjectionSnapshot, event: DomainEvent): ProjectionSnapshot {
  switch (event.type) {
    case 'task.received': {
      const { task } = event.payload;
      const base = emptyTask(task.id, task.sessionId, task.intentRaw, event.ts);
      const next: ProjectionSnapshot = {
        ...snapshot,
        task: {
          ...base,
          goal: task.intentClarified?.goal,
          status: task.status,
          phase: task.phase,
          progress: task.progress,
          stepsTotal: task.plan?.steps.length ?? 0,
          steps: task.plan?.steps.map((s) => toStepView(undefined, {
            id: s.id, idx: s.idx, title: s.title, goal: s.goal, status: s.status,
            weight: s.weight, acceptance: s.acceptance.map(acceptanceView), deps: s.deps,
            startedAt: s.startedAt, endedAt: s.endedAt,
          })) ?? [],
          activity: { kind: 'idle', detail: 'Received the request', since: event.ts },
        },
      };
      return withTimeline(next, event);
    }

    case 'task.clarified':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        goal: event.payload.intent.goal,
        assumptions: event.payload.intent.assumptions,
        constraints: event.payload.intent.constraints,
        activity: { kind: 'planning', detail: 'Clarified the goal — planning next', since: event.ts },
      }));

    case 'task.status_changed':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        status: event.payload.to,
        activity: activityForStatus(event.payload.to, event.ts, t.activity),
      }));

    case 'task.phase_changed':
      return mutateTask(snapshot, event, (t) => ({ ...t, phase: event.payload.phase }));

    case 'task.progress':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        progress: event.payload.progress,
        currentStepIdx: event.payload.currentStepIdx,
        stepsTotal: event.payload.totalSteps,
      }));

    case 'task.paused':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        status: 'paused',
        pausedReason: event.payload.reason,
        activity: { kind: 'idle', detail: `Paused — ${event.payload.reason}`, since: event.ts },
      }));

    case 'task.resumed':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        status: 'executing',
        pausedReason: undefined,
        activity: { kind: 'executing', detail: 'Resumed from the last checkpoint', since: event.ts },
      }));

    case 'task.intervened':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        goal: event.payload.newGoal,
        interventions: push(t.interventions, {
          instruction: event.payload.instruction,
          previousGoal: event.payload.previousGoal,
          newGoal: event.payload.newGoal,
          at: event.ts,
        }),
      }));

    case 'task.completed':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        status: 'done',
        phase: 'delivering',
        progress: 1,
        summary: event.payload.summary,
        artifacts: event.payload.artifacts,
        narration: closeNarration(t.narration),
        activity: { kind: 'idle', detail: 'Task complete', since: event.ts },
      }));

    case 'task.failed':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        status: 'failed',
        failures: push(t.failures, {
          reason: event.payload.reason,
          recoverable: event.payload.recoverable,
          attempts: 0,
          suggestion: event.payload.recoverable ? 'Retry, or let the agent re-plan' : 'Review the failure and re-state the goal',
          at: event.ts,
        }),
        activity: { kind: 'idle', detail: 'Task failed', since: event.ts },
      }));

    case 'task.cancelled':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        status: 'cancelled',
        activity: { kind: 'idle', detail: 'Cancelled', since: event.ts },
      }));

    case 'plan.started':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        phase: 'planning',
        activity: { kind: 'planning', detail: `Planning (${event.payload.mode})`, since: event.ts },
      }));

    case 'plan.ready':
      return mutateTask(snapshot, event, (t) => {
        const steps = event.payload.plan.steps
          .map((s) => toStepView(t.steps.find((x) => x.id === s.id), {
            id: s.id, idx: s.idx, title: s.title, goal: s.goal, status: s.status,
            weight: s.weight, acceptance: s.acceptance.map(acceptanceView), deps: s.deps,
            startedAt: s.startedAt, endedAt: s.endedAt,
          }))
          .sort((a, b) => a.idx - b.idx);
        return {
          ...t,
          steps,
          stepsTotal: steps.length,
          progress: computeProgress(steps),
          activity: { kind: 'executing', detail: `Plan ready — ${steps.length} steps`, since: event.ts },
        };
      });

    case 'plan.revised':
      return mutateTask(snapshot, event, (t) => {
        const steps = event.payload.plan.steps
          .map((s) => toStepView(t.steps.find((x) => x.id === s.id), {
            id: s.id, idx: s.idx, title: s.title, goal: s.goal, status: s.status,
            weight: s.weight, acceptance: s.acceptance.map(acceptanceView), deps: s.deps,
            startedAt: s.startedAt, endedAt: s.endedAt,
          }))
          .sort((a, b) => a.idx - b.idx);
        return {
          ...t,
          steps,
          stepsTotal: steps.length,
          notices: push(t.notices, {
            kind: 'no-progress',
            title: `Plan revised (revision ${event.payload.plan.revision})`,
            detail: event.payload.reason,
            action: 'replan',
            at: event.ts,
          }),
        };
      });

    case 'plan.failed':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        failures: push(t.failures, {
          reason: event.payload.reason,
          recoverable: true,
          attempts: 0,
          suggestion: 'Re-state the goal with more detail, or switch model',
          at: event.ts,
        }),
      }));

    case 'routing.chosen':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        routing: {
          line: event.payload.line,
          estimatedUsd: event.payload.estimatedUsd,
          tokens: event.payload.tokens,
          model: event.payload.model,
        },
      }));

    case 'step.started':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        phase: 'executing',
        currentStepIdx: event.payload.step.idx,
        narration: closeNarration(t.narration),
        steps: patchStep(upsertStep(t.steps, toStepView(undefined, {
          id: event.payload.step.id, idx: event.payload.step.idx, title: event.payload.step.title,
          goal: event.payload.step.goal, status: 'running', weight: event.payload.step.weight,
          acceptance: event.payload.step.acceptance.map(acceptanceView), deps: event.payload.step.deps,
          startedAt: event.ts,
        })), event.payload.step.id, { status: 'running', startedAt: event.ts }),
        activity: { kind: 'executing', detail: event.payload.step.title, since: event.ts },
      }));

    case 'step.completed':
      return mutateTask(snapshot, event, (t) => {
        const steps = patchStep(t.steps, event.payload.step.id, { status: 'done', endedAt: event.ts });
        return {
          ...t,
          steps,
          narration: closeNarration(t.narration),
          progress: computeProgress(steps),
          artifacts: event.payload.result.artifacts.length ? event.payload.result.artifacts : t.artifacts,
        };
      });

    case 'step.failed':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        steps: patchStep(t.steps, event.payload.step.id, { status: 'failed', error: event.payload.error, endedAt: event.ts }),
      }));

    case 'step.skipped':
      return mutateTask(snapshot, event, (t) => {
        const steps = patchStep(t.steps, event.payload.step.id, { status: 'skipped', endedAt: event.ts });
        return { ...t, steps, progress: computeProgress(steps) };
      });

    case 'tool.requested':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        narration: closeNarration(t.narration),
        toolCalls: { ...t.toolCalls, [event.payload.call.id]: mergeToolCall(t.toolCalls[event.payload.call.id], event.payload.call) },
      }));

    case 'tool.approval_required':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        toolCalls: {
          ...t.toolCalls,
          [event.payload.call.id]: { ...mergeToolCall(t.toolCalls[event.payload.call.id], event.payload.call), approval: 'required', status: 'awaiting-approval' },
        },
        approvals: push(t.approvals.filter((a) => a.callId !== event.payload.call.id), {
          callId: event.payload.call.id,
          name: event.payload.call.name,
          risk: event.payload.call.risk,
          input: event.payload.call.input,
          at: event.ts,
        }),
        activity: { kind: 'waiting-approval', detail: `Approval needed: ${event.payload.call.name}`, since: event.ts },
      }));

    case 'tool.approved':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        toolCalls: t.toolCalls[event.payload.callId]
          ? { ...t.toolCalls, [event.payload.callId]: { ...t.toolCalls[event.payload.callId]!, approval: 'approved', status: 'approved' } }
          : t.toolCalls,
        approvals: t.approvals.filter((a) => a.callId !== event.payload.callId),
      }));

    case 'tool.denied':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        toolCalls: t.toolCalls[event.payload.callId]
          ? { ...t.toolCalls, [event.payload.callId]: { ...t.toolCalls[event.payload.callId]!, approval: 'denied', status: 'denied', error: event.payload.reason } }
          : t.toolCalls,
        approvals: t.approvals.filter((a) => a.callId !== event.payload.callId),
      }));

    case 'tool.started':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        toolCalls: t.toolCalls[event.payload.callId]
          ? { ...t.toolCalls, [event.payload.callId]: { ...t.toolCalls[event.payload.callId]!, status: 'running' } }
          : t.toolCalls,
        activity: { kind: 'executing', detail: `Running ${event.payload.name}`, since: event.ts },
      }));

    case 'tool.finished':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        toolCalls: { ...t.toolCalls, [event.payload.call.id]: mergeToolCall(t.toolCalls[event.payload.call.id], event.payload.call) },
      }));

    case 'tool.failed':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        toolCalls: t.toolCalls[event.payload.callId]
          ? { ...t.toolCalls, [event.payload.callId]: { ...t.toolCalls[event.payload.callId]!, status: 'error', error: event.payload.error } }
          : t.toolCalls,
        failures: push(t.failures, {
          reason: `${event.payload.name}: ${event.payload.error}`,
          recoverable: event.payload.recoverable,
          attempts: 0,
          suggestion: event.payload.recoverable ? 'Retry with corrected arguments' : 'Inspect the tool input and adjust the plan',
          at: event.ts,
        }),
      }));

    case 'verify.started':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        phase: 'verifying',
        steps: patchStep(t.steps, event.payload.stepId, { status: 'verifying' }),
        activity: { kind: 'verifying', detail: `Verifying ${event.payload.points} acceptance point(s)`, since: event.ts },
      }));

    case 'verify.result':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        steps: patchStep(t.steps, event.payload.verdict.stepId, {
          verdict: { status: event.payload.verdict.status, reason: event.payload.verdict.reason },
        }),
      }));

    case 'verify.fix_required':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        notices: push(t.notices, {
          kind: 'no-progress',
          title: 'Verification failed — a fix is required',
          detail: event.payload.verdicts.map((v) => v.reason).join('; ') || 'no evidence',
          action: 'fix',
          at: event.ts,
        }),
      }));

    case 'context.budget':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        context: {
          ...t.context,
          window: event.payload.budget.window,
          softLimit: event.payload.budget.softLimit,
          used: event.payload.budget.used,
        },
      }));

    case 'context.compaction_started':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        activity: { kind: 'executing', detail: `Compacting context (${event.payload.reason})`, since: event.ts },
      }));

    case 'context.compacted':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        context: {
          ...t.context,
          used: event.payload.tokensAfter,
          compactions: push(t.context.compactions, {
            tokensBefore: event.payload.tokensBefore,
            tokensAfter: event.payload.tokensAfter,
            droppedMessages: event.payload.droppedMessages,
            summaries: event.payload.summaries,
            droppedPreviews: event.payload.droppedPreviews,
            protectedSlots: event.payload.protectedSlots,
            at: event.ts,
          }),
        },
      }));

    case 'context.deduplicated':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        context: { ...t.context, deduplicated: t.context.deduplicated + event.payload.removed },
      }));

    case 'reliability.drift_detected':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        notices: push(t.notices, {
          kind: 'drift',
          title: `Goal drift detected (score ${event.payload.score.toFixed(2)})`,
          detail: event.payload.signals.join('; ') || 'output diverged from the goal',
          action: event.payload.action,
          at: event.ts,
        }),
      }));

    case 'reliability.loop_detected':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        notices: push(t.notices, {
          kind: 'loop',
          title: `Repeated action broken (×${event.payload.repeats})`,
          detail: event.payload.fingerprint,
          action: event.payload.action,
          at: event.ts,
        }),
      }));

    case 'reliability.hallucination_blocked':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        notices: push(t.notices, {
          kind: 'hallucination',
          title: 'Unsupported completion claim blocked',
          detail: `${event.payload.claim} — ${event.payload.reason}`,
          action: 'downgraded to unverified',
          at: event.ts,
        }),
      }));

    case 'reliability.no_progress':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        notices: push(t.notices, {
          kind: 'no-progress',
          title: `No progress for ${event.payload.streak} iterations`,
          detail: 'The loop stalled and re-anchored the goal',
          action: event.payload.action,
          at: event.ts,
        }),
      }));

    case 'recovery.classified':
      return mutateTask(snapshot, event, (t) => {
        const last = t.failures[t.failures.length - 1];
        if (!last) return t;
        const failures = [...t.failures];
        failures[failures.length - 1] = { ...last, errorClass: event.payload.errorClass };
        return { ...t, failures };
      });

    case 'recovery.attempted':
      return mutateTask(snapshot, event, (t) => {
        const last = t.failures[t.failures.length - 1];
        if (!last) return t;
        const failures = [...t.failures];
        failures[failures.length - 1] = { ...last, attempts: event.payload.attempt, strategy: event.payload.strategy };
        return { ...t, failures };
      });

    case 'recovery.succeeded':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        notices: push(t.notices, {
          kind: 'rollback',
          title: `Recovered via ${event.payload.strategy}`,
          detail: `Succeeded after ${event.payload.attempts} attempt(s)`,
          action: 'resumed',
          at: event.ts,
        }),
      }));

    case 'recovery.failed':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        failures: push(t.failures, {
          reason: event.payload.error,
          recoverable: false,
          attempts: event.payload.attempts,
          strategy: event.payload.strategy,
          suggestion: 'All recovery strategies exhausted — review and re-state the goal',
          at: event.ts,
        }),
      }));

    case 'recovery.rollback_started':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        activity: { kind: 'executing', detail: 'Rolling back to checkpoint', since: event.ts },
      }));

    case 'recovery.rollback_done':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        notices: push(t.notices, {
          kind: 'rollback',
          title: 'Rollback complete',
          detail: `Restored ${event.payload.restored} file(s) to checkpoint ${event.payload.checkpointId.slice(0, 8)}`,
          action: 'rolled-back',
          at: event.ts,
        }),
      }));

    case 'subagent.spawned':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        subAgents: push(t.subAgents, {
          id: event.payload.id,
          goal: event.payload.goal,
          status: 'running',
          artifacts: [],
          startedAt: event.ts,
        }),
      }));

    case 'subagent.finished':
      return mutateTask(snapshot, event, (t) => {
        const report = event.payload.report;
        const entry: SubAgentView = {
          id: report.id,
          goal: report.goal,
          status: report.status,
          summary: report.summary,
          tokensUsed: report.tokensUsed,
          artifacts: report.artifacts,
          startedAt: report.startedAt,
          endedAt: report.endedAt,
        };
        const exists = t.subAgents.some((s) => s.id === report.id);
        return {
          ...t,
          subAgents: exists ? t.subAgents.map((s) => (s.id === report.id ? entry : s)) : [...t.subAgents, entry],
        };
      });

    case 'provider.selected':
      return withTimeline(
        {
          ...snapshot,
          provider: {
            ...snapshot.provider,
            activeProvider: event.payload.providerId,
            activeModel: event.payload.model,
            reason: event.payload.reason,
            // `models` is deliberately left alone. It is tagged with the provider it came
            // from (`modelsFor`), so a reader compares the two instead of relying on every
            // writer to remember to invalidate it — the scenario emits `provider.selected`
            // during boot, and clearing here would erase the bootstrap list before the UI
            // ever saw it.
          },
        },
        event,
      );

    case 'provider.fallback':
      return withTimeline(
        {
          ...snapshot,
          provider: {
            ...snapshot.provider,
            activeProvider: event.payload.to,
            fallbacks: push(snapshot.provider.fallbacks, {
              from: event.payload.from,
              to: event.payload.to,
              reason: event.payload.reason,
              depth: event.payload.depth,
              at: event.ts,
            }),
          },
        },
        event,
      );

    case 'provider.capabilities':
      return withTimeline(snapshot, event);

    case 'checkpoint.created':
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        checkpoints: push(t.checkpoints, {
          id: event.payload.checkpoint.id,
          stepIdx: event.payload.checkpoint.stepIdx,
          ctxSummary: event.payload.checkpoint.ctxSummary,
          at: event.ts,
        }),
      }));

    case 'selfreview.performed':
    case 'selfreview.skipped':
    case 'memory.written':
    case 'memory.recalled':
    case 'memory.forgotten':
    case 'memory.reactivated':
    case 'memory.downgraded':
    case 'memory.promoted':
    case 'memory.critiqued':
    case 'tool.usage_injected':
      return withTimeline(snapshot, event);

    // ---- Chat (direct conversation path) ---------------------------------
    case 'chat.received':
      return mutateChat(snapshot, event, (chat) =>
        pushChatTurn(chat, {
          id: event.payload.turnId,
          role: 'user',
          text: event.payload.text,
          images: event.payload.images,
          streaming: false,
          toolCalls: [],
          at: event.ts,
        }),
      );

    case 'chat.delta':
      return mutateChat(snapshot, event, (chat) =>
        appendChatDelta(chat, event.payload.turnId, event.payload.delta, event.ts),
      );

    case 'chat.message':
      return mutateChat(snapshot, event, (chat) => {
        const last = chat.turns[chat.turns.length - 1];
        if (!last || last.id !== event.payload.turnId || last.role !== 'assistant') return chat;
        const turns = [...chat.turns];
        turns[turns.length - 1] = {
          ...last,
          text: event.payload.text.slice(0, MAX_CHAT_CHARS) || last.text,
          streaming: false,
          at: event.ts,
        };
        return { ...chat, turns };
      });

    case 'chat.tool':
      return mutateChat(snapshot, event, (chat) => {
        const call = event.payload.call;
        const turn = chat.turns.find((t) => t.id === call.taskId);
        if (!turn) return chat;
        const turns = chat.turns.map((t) =>
          t.id === call.taskId
            ? upsertChatTool(t, call, call.status === 'awaiting-approval')
            : t,
        );
        return { ...chat, turns };
      });

    case 'chat.ask_user':
      return mutateChat(snapshot, event, (chat) => ({
        ...chat,
        pendingAsk: {
          askId: event.payload.askId,
          question: event.payload.question,
          options: event.payload.options,
          at: event.ts,
        },
      }));

    case 'chat.answered':
      return mutateChat(snapshot, event, (chat) => {
        const option = chat.pendingAsk?.options[event.payload.optionIdx];
        const cleared = { ...chat, pendingAsk: undefined };
        return option
          ? pushChatTurn(cleared, {
              id: `ans-${event.payload.askId}`,
              role: 'user',
              text: option,
              streaming: false,
              toolCalls: [],
              at: event.ts,
            })
          : cleared;
      });

    case 'chat.failed':
      return mutateChat(snapshot, event, (chat) => {
        const last = chat.turns[chat.turns.length - 1];
        if (!last || last.id !== event.payload.turnId || last.role !== 'assistant') return chat;
        const turns = [...chat.turns];
        turns[turns.length - 1] = { ...last, streaming: false, error: event.payload.error, at: event.ts };
        return { ...chat, turns };
      });

    case 'chat.policy_changed':
      return mutateChat(snapshot, event, (chat) => ({ ...chat, policy: event.payload.policy }));

    case 'metric':
      return withTimeline({ ...snapshot, metrics: { ...snapshot.metrics, [event.payload.name]: event.payload.value } }, event);

    case 'log': {
      const meta = event.payload.meta as { stream?: boolean } | undefined;
      if (!meta?.stream) return withTimeline(snapshot, event);
      return mutateTask(snapshot, event, (t) => ({
        ...t,
        narration: appendNarration(t, event.payload.message, event.ts),
      }));
    }
  }
}

/** Fold a batch of events — the shape the transport and the store actually use. */
export function reduceEvents(snapshot: ProjectionSnapshot, events: Iterable<DomainEvent>): ProjectionSnapshot {
  let next = snapshot;
  for (const event of events) next = applyEvent(next, event);
  return next;
}

function activityForStatus(status: TaskStatus, at: number, previous: ActivityView): ActivityView {
  switch (status) {
    case 'clarifying':
      return { kind: 'planning', detail: 'Clarifying the request', since: at };
    case 'planning':
      return { kind: 'planning', detail: 'Planning', since: at };
    case 'awaiting-approval':
      return { kind: 'waiting-approval', detail: 'Plan is waiting for approval', since: at };
    case 'executing':
      return { kind: 'executing', detail: previous.kind === 'executing' ? previous.detail : 'Executing', since: at };
    case 'verifying':
      return { kind: 'verifying', detail: 'Verifying results', since: at };
    case 'delivering':
      return { kind: 'delivering', detail: 'Delivering', since: at };
    case 'reflecting':
      return { kind: 'delivering', detail: 'Reflecting on the run', since: at };
    case 'done':
      return { kind: 'idle', detail: 'Task complete', since: at };
    case 'failed':
      return { kind: 'idle', detail: 'Task failed', since: at };
    case 'cancelled':
      return { kind: 'idle', detail: 'Cancelled', since: at };
    case 'paused':
      return { kind: 'idle', detail: 'Paused', since: at };
    case 'received':
    default:
      return { kind: 'idle', detail: 'Received the request', since: at };
  }
}