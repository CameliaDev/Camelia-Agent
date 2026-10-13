/**
 * Test doubles and a `RunContext` builder for the harness.
 *
 * The harness is exercised against ports, never against Node or a live model
 * (whitepaper §2.2). This module is the single place those fakes are assembled so
 * every engine test speaks the same setup language.
 * @module
 */

import type {
  ChatChunk,
  ChatRequest,
  Checkpoint,
  ClarifiedIntent,
  CreateSessionInput,
  ClockPort,
  EventBus as EventBusType,
  FileStat,
  ForgetLogEntry,
  FsPort,
  Id,
  JsonValue,
  LLMPort,
  LLMToolCall,
  LoggerPort,
  LogLevel,
  MemoryItem,
  MemoryPatch,
  MemoryQuery,
  Message,
  ModelInfo,
  ProviderCapabilities,
  SearchPort,
  Session,
  SessionStore,
  ShellOptions,
  ShellResult,
  ShellPort,
  Step,
  StoredEvent,
  Task,
  ToolCall,
  Verdict,
} from '@camelia/core';
import {
  EventBus,
  InMemoryMetrics,
  InMemoryTracer,
  estimateTokens,
  isTerminal,
  newId,
} from '@camelia/core';

import type { HarnessConfig, HarnessInfra, HarnessPorts, RunContext } from '../../src/index.js';
import { resolveConfig } from '../../src/index.js';
import { FakeFs } from './fake-fs.js';

// ---------------------------------------------------------------------------
// Scripted LLM
// ---------------------------------------------------------------------------

export interface ScriptedTurn {
  text?: string;
  toolCalls?: { id?: string; name: string; arguments?: JsonValue | string }[];
  usage?: { promptTokens: number; completionTokens: number };
  /** Emit an error chunk instead of a normal turn. */
  error?: string;
  finishReason?: 'stop' | 'tool_calls' | 'length';
  /** Delay before emitting (ms) — used to test abort during a turn. */
  delayMs?: number;
}

export type TurnSource = ScriptedTurn[] | ((request: ChatRequest, callIndex: number) => ScriptedTurn);

const DEFAULT_CAPS: ProviderCapabilities = {
  supportsTools: true,
  supportsJson: true,
  supportsStreaming: true,
  maxContextWindow: 128_000,
  quality: 0.9,
};

/**
 * A deterministic `LLMPort`. Turns are consumed in order; the last turn repeats
 * once exhausted so an accidental extra call is visible rather than crashing.
 */
export class ScriptedLLM implements LLMPort {
  readonly id = 'scripted';
  readonly requests: ChatRequest[] = [];
  private index = 0;

  constructor(
    private readonly source: TurnSource,
    private readonly caps: Partial<ProviderCapabilities> = {},
  ) {}

  capabilities(): ProviderCapabilities {
    return { ...DEFAULT_CAPS, ...this.caps };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{
      id: 'scripted-1',
      providerId: 'scripted',
      label: 'Scripted',
      contextWindow: 128_000,
      supportsTools: true,
      supportsJson: true,
      supportsVision: this.caps.supportsVision === true,
    }];
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const callIndex = this.index;
    this.index += 1;
    this.requests.push(request);

    const turn =
      (typeof this.source === 'function' ? this.source(request, callIndex) : this.source[Math.min(callIndex, this.source.length - 1)]) ??
      { text: '' };

    if (turn.delayMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, turn.delayMs));
    }
    if (signal?.aborted) {
      yield { type: 'error', message: 'aborted', retryable: false };
      return;
    }

    if (turn.error) {
      yield { type: 'error', message: turn.error, retryable: /timed? ?out|429|503|ECONNRESET|temporarily/i.test(turn.error) };
      yield { type: 'done', finishReason: 'error' };
      return;
    }

    if (turn.text) yield { type: 'text-delta', text: turn.text };
    for (const call of turn.toolCalls ?? []) {
      const toolCall: LLMToolCall = {
        id: call.id ?? newId(),
        name: call.name,
        arguments: call.arguments ?? {},
      };
      yield { type: 'tool-call', call: toolCall };
    }
    if (turn.usage) {
      yield { type: 'usage', promptTokens: turn.usage.promptTokens, completionTokens: turn.usage.completionTokens };
    }
    yield {
      type: 'done',
      finishReason: turn.finishReason ?? (turn.toolCalls?.length ? 'tool_calls' : 'stop'),
    };
  }
}

// ---------------------------------------------------------------------------
// Shell / Search / Clock / Logger
// ---------------------------------------------------------------------------

export class FakeShell implements ShellPort {
  readonly commands: { command: string; options?: ShellOptions }[] = [];
  constructor(private readonly handler: (command: string, options?: ShellOptions) => Partial<ShellResult> = () => ({})) {}

  async exec(command: string, options?: ShellOptions): Promise<ShellResult> {
    this.commands.push({ command, options });
    const partial = this.handler(command, options);
    return {
      code: partial.code ?? 0,
      stdout: partial.stdout ?? '',
      stderr: partial.stderr ?? '',
      durationMs: partial.durationMs ?? 1,
      timedOut: partial.timedOut ?? false,
      truncated: partial.truncated ?? false,
    };
  }
}

export class FakeSearch implements SearchPort {
  constructor(
    private readonly globs: string[] = [],
    private readonly matches: { path: string; line: number; column: number; text: string }[] = [],
  ) {}
  async glob(): Promise<string[]> {
    return [...this.globs];
  }
  async grep(): Promise<{ path: string; line: number; column: number; text: string }[]> {
    return [...this.matches];
  }
}

/** Deterministic, monotonically advancing clock — no real sleeping. */
export class FakeClock implements ClockPort {
  constructor(private time = 1_700_000_000_000) {}
  now(): number {
    return this.time;
  }
  async sleep(ms: number): Promise<void> {
    this.time += ms;
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

export class RecordingLogger implements LoggerPort {
  readonly lines: { level: LogLevel; message: string; meta?: JsonValue }[] = [];
  constructor(private readonly bindings: Record<string, JsonValue> = {}) {}
  log(level: LogLevel, message: string, meta?: JsonValue): void {
    this.lines.push({ level, message, meta });
  }
  debug(message: string, meta?: JsonValue): void {
    this.log('debug', message, meta);
  }
  info(message: string, meta?: JsonValue): void {
    this.log('info', message, meta);
  }
  warn(message: string, meta?: JsonValue): void {
    this.log('warn', message, meta);
  }
  error(message: string, meta?: JsonValue): void {
    this.log('error', message, meta);
  }
  child(bindings: Record<string, JsonValue>): LoggerPort {
    return new RecordingLogger({ ...this.bindings, ...bindings });
  }
}

// ---------------------------------------------------------------------------
// In-memory SessionStore
// ---------------------------------------------------------------------------

export class MemoryStore implements SessionStore {
  readonly sessions = new Map<Id, Session>();
  readonly tasks = new Map<Id, Task>();
  readonly steps = new Map<Id, Step>();
  readonly toolCalls = new Map<Id, ToolCall>();
  readonly messages: Message[] = [];
  readonly verdicts: Verdict[] = [];
  readonly checkpoints: Checkpoint[] = [];
  readonly memories: MemoryItem[] = [];
  readonly forgetLog: ForgetLogEntry[] = [];
  readonly events: StoredEvent[] = [];
  readonly metrics: { name: string; value: number; taskId?: Id }[] = [];
  readonly failureModes: { kind: string; mechanism: string; workspace: string }[] = [];
  private seq = 0;

  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = Date.now();
    const session: Session = { id: newId(), ...input, kind: input.kind ?? 'work', createdAt: now, updatedAt: now };
    this.sessions.set(session.id, session);
    return session;
  }
  async getSession(id: Id): Promise<Session | undefined> {
    return this.sessions.get(id);
  }
  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()];
  }
  async updateSession(id: Id, patch: Partial<Pick<Session, 'title' | 'provider' | 'model'>>): Promise<void> {
    const session = this.sessions.get(id);
    if (session) Object.assign(session, patch);
  }

  async createTask(input: { sessionId: Id; intentRaw: string; workspace?: string; id?: Id }): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      id: input.id ?? newId(),
      sessionId: input.sessionId,
      intentRaw: input.intentRaw,
      status: 'received',
      phase: 'idle',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }
  async getTask(id: Id): Promise<Task | undefined> {
    return this.tasks.get(id);
  }
  async listTasks(sessionId: Id): Promise<Task[]> {
    return [...this.tasks.values()].filter((t) => t.sessionId === sessionId);
  }
  async listUnsettledTasks(): Promise<Task[]> {
    return [...this.tasks.values()].filter((t) => !isTerminal(t.status) && t.status !== 'paused');
  }
  async updateTask(id: Id, patch: Partial<Task>): Promise<void> {
    const task = this.tasks.get(id);
    if (task) Object.assign(task, patch, { updatedAt: Date.now() });
  }

  async upsertStep(step: Step): Promise<void> {
    this.steps.set(step.id, { ...step });
  }
  async listSteps(taskId: Id): Promise<Step[]> {
    return [...this.steps.values()].filter((s) => s.taskId === taskId).sort((a, b) => a.idx - b.idx);
  }

  async insertToolCall(call: ToolCall): Promise<void> {
    this.toolCalls.set(call.id, { ...call });
  }
  async updateToolCall(id: Id, patch: Partial<ToolCall>): Promise<void> {
    const call = this.toolCalls.get(id);
    if (call) Object.assign(call, patch);
  }
  async listToolCalls(taskId: Id): Promise<ToolCall[]> {
    return [...this.toolCalls.values()].filter((c) => c.taskId === taskId);
  }

  async appendMessage(message: Message): Promise<void> {
    this.messages.push(message);
  }
  async listMessages(taskId: Id): Promise<Message[]> {
    return this.messages.filter((m) => m.taskId === taskId);
  }
  async markMessagesCompacted(ids: Id[]): Promise<void> {
    for (const m of this.messages) if (ids.includes(m.id)) m.compacted = true;
  }

  async insertVerdict(verdict: Verdict): Promise<void> {
    this.verdicts.push(verdict);
  }
  async listVerdicts(taskId: Id): Promise<Verdict[]> {
    return this.verdicts.filter((v) => v.taskId === taskId);
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.push(checkpoint);
  }
  async listCheckpoints(taskId: Id): Promise<Checkpoint[]> {
    return this.checkpoints.filter((c) => c.taskId === taskId);
  }
  async latestCheckpoint(taskId: Id): Promise<Checkpoint | undefined> {
    return [...this.checkpoints].reverse().find((c) => c.taskId === taskId);
  }

  async writeMemory(item: MemoryItem): Promise<void> {
    this.memories.push(item);
  }
  async searchMemories(query: MemoryQuery): Promise<MemoryItem[]> {
    return this.memories.filter((m) => {
      if (query.scope && m.scope !== query.scope) return false;
      if (query.sessionId && m.scope !== 'global' && m.sessionId !== query.sessionId) return false;
      if (query.kind && m.kind !== query.kind) return false;
      if (query.layer && m.layer !== query.layer) return false;
      if (query.text) {
        const queryTokens = new Set(
          query.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2),
        );
        const itemTokens = new Set(
          `${m.content} ${m.keywords}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2),
        );
        let overlap = false;
        for (const token of queryTokens) {
          if (itemTokens.has(token)) { overlap = true; break; }
        }
        if (!overlap) return false;
      }
      return true;
    });
  }
  async getMemory(id: Id): Promise<MemoryItem | undefined> {
    return this.memories.find((m) => m.id === id);
  }
  async updateMemory(id: Id, patch: MemoryPatch): Promise<void> {
    const item = this.memories.find((m) => m.id === id);
    if (!item) return;
    if (patch.strength !== undefined) item.strength = patch.strength;
    if (patch.importance !== undefined) item.importance = patch.importance;
    if (patch.lastHitAt !== undefined) item.lastHitAt = patch.lastHitAt;
    if (patch.hits !== undefined) item.hits = patch.hits;
    if (patch.nextReviewAt !== undefined) item.nextReviewAt = patch.nextReviewAt;
    if (patch.correctness !== undefined) item.correctness = patch.correctness;
    if (patch.layer !== undefined) item.layer = patch.layer;
    if (patch.scope !== undefined) item.scope = patch.scope;
    if (patch.evidence !== undefined) item.evidence = patch.evidence;
  }
  async deleteMemory(id: Id): Promise<void> {
    const idx = this.memories.findIndex((m) => m.id === id);
    if (idx >= 0) this.memories.splice(idx, 1);
  }
  async listAllMemories(limit = 5_000): Promise<MemoryItem[]> {
    return this.memories.slice(0, limit);
  }
  async appendForgetLog(entry: ForgetLogEntry): Promise<void> {
    this.forgetLog.push(entry);
  }
  async listForgetLog(limit = 200): Promise<ForgetLogEntry[]> {
    return this.forgetLog.slice(0, limit);
  }

  async appendEvent(sessionId: Id | undefined, event: StoredEvent): Promise<number> {
    this.seq += 1;
    this.events.push({ ...event, sessionId, seq: this.seq });
    return this.seq;
  }
  async listEvents(): Promise<StoredEvent[]> {
    return [...this.events];
  }

  async recordMetric(record: { taskId?: Id; name: string; value: number }): Promise<void> {
    this.metrics.push({ taskId: record.taskId, name: record.name, value: record.value });
  }
  async listMetrics(taskId?: Id): Promise<{ name: string; value: number; taskId?: Id }[]> {
    return taskId ? this.metrics.filter((m) => m.taskId === taskId) : [...this.metrics];
  }

  async recordFailureMode(input: { kind: string; mechanism: string; workspace: string }): Promise<void> {
    this.failureModes.push(input);
  }
  async countFailureModes(workspace: string, kind?: string): Promise<number> {
    return this.failureModes.filter((row) => row.workspace === workspace && (kind === undefined || row.kind === kind)).length;
  }

  close(): void {}
}

// ---------------------------------------------------------------------------
// RunContext builder
// ---------------------------------------------------------------------------

export interface Harness {
  ctx: RunContext;
  fs: FakeFs;
  shell: FakeShell;
  search: FakeSearch;
  llm: ScriptedLLM;
  store: MemoryStore;
  logger: RecordingLogger;
  clock: FakeClock;
  bus: EventBus;
  metrics: InMemoryMetrics;
  tracer: InMemoryTracer;
  /** Every event emitted during the run, in order. */
  events: { type: string; payload: unknown }[];
}

export interface HarnessOptions {
  workspace?: string;
  seed?: Record<string, string>;
  llm?: ScriptedLLM;
  shell?: FakeShell;
  search?: FakeSearch;
  config?: Partial<HarnessConfig>;
  taskId?: Id;
  sessionId?: Id;
  signal?: AbortSignal;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const workspace = options.workspace ?? 'C:/workspace';
  const fs = new FakeFs(options.seed ?? {});
  const shell = options.shell ?? new FakeShell();
  const search = options.search ?? new FakeSearch();
  const llm = options.llm ?? new ScriptedLLM([{ text: 'ok' }]);
  const store = new MemoryStore();
  const logger = new RecordingLogger();
  const clock = new FakeClock();
  const metrics = new InMemoryMetrics();
  const tracer = new InMemoryTracer();

  const events: { type: string; payload: unknown }[] = [];
  const bus = new EventBus({
    onEmit: (event) => {
      events.push({ type: event.type, payload: event.payload });
    },
  });

  const ports: HarnessPorts = { llm, fs, shell, search, clock, logger };
  const infra: HarnessInfra = { bus, store, tracer, metrics, logger };

  const ctx: RunContext = {
    taskId: options.taskId ?? newId(),
    sessionId: options.sessionId ?? newId(),
    workspace,
    traceId: 'trace-test',
    model: 'scripted-1',
    gruntModel: 'scripted-1',
    ports,
    infra,
    config: resolveConfig(options.config ?? {}),
    signal: options.signal ?? new AbortController().signal,
  };

  return { ctx, fs, shell, search, llm, store, logger, clock, bus, metrics, tracer, events };
}

/** Convenience: an acceptance point with a stable shape. */
export function acceptancePoint(
  kind: 'file-exists' | 'file-contains' | 'command-exit-zero' | 'test-pass' | 'diff-nonempty' | 'manual',
  params: Record<string, JsonValue> = {},
  description = kind,
): { id: string; description: string; kind: typeof kind; params: Record<string, JsonValue> } {
  return { id: newId(), description, kind, params };
}

/** Build a step with sensible defaults for engine tests. */
export function makeStep(partial: Partial<Step> & { idx: number }): Step {
  return {
    id: partial.id ?? newId(),
    taskId: partial.taskId ?? 'task-1',
    idx: partial.idx,
    title: partial.title ?? `Step ${partial.idx + 1}`,
    goal: partial.goal ?? 'do the thing',
    status: partial.status ?? 'pending',
    acceptance: partial.acceptance ?? [],
    weight: partial.weight ?? 1,
    deps: partial.deps ?? [],
  };
}

export function makeIntent(partial: Partial<ClarifiedIntent> = {}): ClarifiedIntent {
  return {
    goal: partial.goal ?? 'Add a CONTRIBUTING.md file',
    assumptions: partial.assumptions ?? [],
    constraints: partial.constraints ?? [],
    expectedPaths: partial.expectedPaths ?? ['CONTRIBUTING.md'],
    complete: partial.complete ?? true,
  };
}

/** Estimate tokens for a string, re-exported so tests share the engine's math. */
export { estimateTokens };

/** A file stat for fake listings. */
export function fakeStat(path: string, content = ''): FileStat {
  return { path, size: content.length, mtimeMs: 0, isFile: true, isDir: false };
}

export type { FsPort, EventBusType };