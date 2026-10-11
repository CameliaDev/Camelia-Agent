/**
 * Session store port — persistence boundary.
 *
 * Async on purpose: the local implementation is synchronous (better-sqlite3),
 * but keeping the contract async means the store can be swapped for a remote or
 * in-memory fake without touching a single caller (whitepaper §3.9).
 * @module
 */

import type { Id } from '../types/common.js';
import type {
  Checkpoint,
  ClarifiedIntent,
  ForgetLogEntry,
  MemoryEvidence,
  MemoryItem,
  MemoryKind,
  MemoryLayer,
  Message,
  Plan,
  Session,
  Step,
  Task,
  TaskPhase,
  TaskStatus,
  ToolCall,
  Verdict,
} from '../types/domain.js';
import type { StoredEvent } from '../types/events.js';

export interface CreateSessionInput {
  title: string;
  workspace: string;
  provider: string;
  model: string;
}

export interface CreateTaskInput {
  sessionId: Id;
  intentRaw: string;
  workspace?: string;
}

export interface TaskPatch {
  intentClarified?: ClarifiedIntent;
  status?: TaskStatus;
  phase?: TaskPhase;
  plan?: Plan;
  progress?: number;
  resumeTarget?: TaskStatus | undefined;
}

export interface ToolCallPatch {
  output?: unknown;
  status?: ToolCall['status'];
  durationMs?: number;
  error?: string;
}

export interface EventQuery {
  taskId?: Id;
  sessionId?: Id;
  /** Exclusive lower bound on `seq`. */
  afterSeq?: number;
  limit?: number;
}

export interface MemoryQuery {
  scope?: 'global' | 'session';
  sessionId?: Id;
  kind?: MemoryKind;
  layer?: MemoryLayer;
  /** Free-text match against content + keywords. */
  text?: string;
  limit?: number;
}

/** Partial update for a memory's lifecycle fields (Iteration 20). */
export interface MemoryPatch {
  strength?: number;
  importance?: number;
  lastHitAt?: number;
  hits?: number;
  nextReviewAt?: number | null;
  correctness?: number;
  layer?: MemoryLayer;
  /** Re-scope (e.g. session → global when promoting to long-term). */
  scope?: 'global' | 'session';
  /** Evidence of the verification that closed the correctness loop (Iteration 22). */
  evidence?: MemoryEvidence | null;
}

export interface MetricRecord {
  taskId?: Id;
  name: string;
  value: number;
  count?: number;
  tags?: Record<string, string>;
}

export interface SessionStore {
  // ---- sessions -----------------------------------------------------------
  createSession(input: CreateSessionInput): Promise<Session>;
  getSession(id: Id): Promise<Session | undefined>;
  listSessions(limit?: number): Promise<Session[]>;
  updateSession(id: Id, patch: Partial<Pick<Session, 'title' | 'provider' | 'model'>>): Promise<void>;

  // ---- tasks --------------------------------------------------------------
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: Id): Promise<Task | undefined>;
  listTasks(sessionId: Id): Promise<Task[]>;
  updateTask(id: Id, patch: TaskPatch): Promise<void>;

  // ---- steps --------------------------------------------------------------
  upsertStep(step: Step): Promise<void>;
  listSteps(taskId: Id): Promise<Step[]>;

  // ---- tool calls ---------------------------------------------------------
  insertToolCall(call: ToolCall): Promise<void>;
  updateToolCall(id: Id, patch: ToolCallPatch): Promise<void>;
  listToolCalls(taskId: Id): Promise<ToolCall[]>;

  // ---- messages -----------------------------------------------------------
  appendMessage(message: Message): Promise<void>;
  listMessages(taskId: Id): Promise<Message[]>;
  markMessagesCompacted(ids: Id[]): Promise<void>;

  // ---- verdicts -----------------------------------------------------------
  insertVerdict(verdict: Verdict): Promise<void>;
  listVerdicts(taskId: Id): Promise<Verdict[]>;

  // ---- checkpoints --------------------------------------------------------
  saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  listCheckpoints(taskId: Id): Promise<Checkpoint[]>;
  latestCheckpoint(taskId: Id): Promise<Checkpoint | undefined>;

  // ---- memories -----------------------------------------------------------
  writeMemory(item: MemoryItem): Promise<void>;
  searchMemories(query: MemoryQuery): Promise<MemoryItem[]>;
  getMemory(id: Id): Promise<MemoryItem | undefined>;
  /** Update lifecycle fields of one memory (hits, lastHitAt, strength...). */
  updateMemory(id: Id, patch: MemoryPatch): Promise<void>;
  /** Hard-delete a memory. Every call must be paired with a forget-log entry. */
  deleteMemory(id: Id): Promise<void>;
  /** All memories, for value-scoring / budget eviction. */
  listAllMemories(limit?: number): Promise<MemoryItem[]>;
  /** Append a forgetting decision to the audit trail. */
  appendForgetLog(entry: ForgetLogEntry): Promise<void>;
  listForgetLog(limit?: number): Promise<ForgetLogEntry[]>;

  // ---- event log (replay / resume) ---------------------------------------
  appendEvent(sessionId: Id | undefined, event: StoredEvent): Promise<number>;
  listEvents(query: EventQuery): Promise<StoredEvent[]>;

  // ---- metrics ------------------------------------------------------------
  recordMetric(record: MetricRecord): Promise<void>;
  listMetrics(taskId?: Id): Promise<MetricRecord[]>;

  // ---- failure modes (Iteration 23) ---------------------------------------
  recordFailureMode(input: FailureModeInput): Promise<void>;
  countFailureModes(workspace: string, kind?: FailureModeKind): Promise<number>;

  close(): void;
}

/** A recorded way a run failed. The row points at a mechanism, not a prompt sentence. */
export type FailureModeKind =
  | 'path-hallucination'
  | 'zero-tool-calls'
  | 'context-exhaustion'
  | 'declared-but-ineffective'
  | 'abi-mismatch';

export interface FailureModeInput {
  kind: FailureModeKind;
  mechanism: string;
  workspace: string;
}