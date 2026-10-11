/**
 * better-sqlite3 implementation of {@link SessionStore}.
 *
 * Synchronous under the hood (SQLite is fast enough that the async wrapper costs
 * nothing measurable), transactional where atomicity matters.
 * @module
 */

import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

import type { Id, JsonValue } from '../types/common.js';
import type {
  Checkpoint,
  ClarifiedIntent,
  ForgetLogEntry,
  FsManifest,
  MemoryItem,
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
import { newId } from '../utils/id.js';
import { migrate } from './schema.js';
import type {
  CreateSessionInput,
  CreateTaskInput,
  EventQuery,
  MemoryPatch,
  MemoryQuery,
  MetricRecord,
  SessionStore,
  TaskPatch,
  ToolCallPatch,
} from './SessionStore.js';

interface SessionRow {
  id: string;
  title: string;
  workspace: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
}

interface TaskRow {
  id: string;
  session_id: string;
  intent_raw: string;
  intent_clarified: string | null;
  status: string;
  phase: string;
  plan_json: string | null;
  progress: number;
  resume_target: string | null;
  created_at: number;
  updated_at: number;
}

interface StepRow {
  id: string;
  task_id: string;
  idx: number;
  title: string;
  goal: string;
  status: string;
  acceptance_json: string;
  weight: number;
  deps_json: string;
  started_at: number | null;
  ended_at: number | null;
}

interface ToolCallRow {
  id: string;
  step_id: string;
  task_id: string;
  name: string;
  input_json: string;
  output_json: string | null;
  status: string;
  risk: string;
  reversible: number;
  duration_ms: number | null;
  error: string | null;
  trace_id: string;
  created_at: number;
}

interface MessageRow {
  id: string;
  task_id: string;
  role: string;
  content: string;
  name: string | null;
  tokens: number;
  compacted: number;
  created_at: number;
}

interface VerdictRow {
  id: string;
  step_id: string;
  task_id: string;
  status: string;
  evidence_json: string;
  reason: string;
  created_at: number;
}

interface CheckpointRow {
  id: string;
  task_id: string;
  step_idx: number;
  ctx_summary: string;
  fs_manifest: string;
  created_at: number;
}

interface MemoryRow {
  id: string;
  scope: string;
  session_id: string | null;
  kind: string;
  content: string;
  keywords: string;
  strength: number;
  importance: number;
  last_hit_at: number | null;
  ttl: number | null;
  hits: number;
  next_review_at: number | null;
  retrievable: number;
  correctness: number;
  layer: string;
  evidence_json: string | null;
  created_at: number;
  updated_at: number;
}

interface ForgetLogRow {
  id: string;
  memory_id: string;
  content_snippet: string;
  reason: string;
  value: number;
  created_at: number;
}

interface EventRow {
  seq: number;
  session_id: string | null;
  task_id: string | null;
  type: string;
  payload: string;
  trace_id: string;
  ts: number;
}

interface MetricRow {
  task_id: string | null;
  name: string;
  value: number;
  count: number;
  tags_json: string;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Clamp a 0..1 score. Used for every lifecycle field that is a probability-like score. */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class SqliteSessionStore implements SessionStore {
  private readonly db: BetterSqlite3.Database;

  constructor(filename = ':memory:') {
    this.db = new Database(filename);
    migrate(this.db);
  }

  /** Wrap a function in a SQLite transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  get raw(): BetterSqlite3.Database {
    return this.db;
  }

  // ---- sessions -----------------------------------------------------------

  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      id: newId(),
      title: input.title,
      workspace: input.workspace,
      provider: input.provider,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, workspace, provider, model, created_at, updated_at)
         VALUES (@id, @title, @workspace, @provider, @model, @createdAt, @updatedAt)`,
      )
      .run(session);
    return session;
  }

  async getSession(id: Id): Promise<Session | undefined> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? mapSession(row) : undefined;
  }

  async listSessions(limit = 50): Promise<Session[]> {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as SessionRow[];
    return rows.map(mapSession);
  }

  async updateSession(
    id: Id,
    patch: Partial<Pick<Session, 'title' | 'provider' | 'model'>>,
  ): Promise<void> {
    const sets: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { id, updatedAt: Date.now() };
    for (const key of ['title', 'provider', 'model'] as const) {
      if (patch[key] !== undefined) {
        sets.push(`${key} = @${key}`);
        params[key] = patch[key];
      }
    }
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  // ---- tasks --------------------------------------------------------------

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      id: newId(),
      sessionId: input.sessionId,
      intentRaw: input.intentRaw,
      status: 'received',
      phase: 'planning',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (id, session_id, intent_raw, intent_clarified, status, phase, plan_json,
                            progress, resume_target, created_at, updated_at)
         VALUES (@id, @sessionId, @intentRaw, NULL, @status, @phase, NULL, @progress, NULL, @createdAt, @updatedAt)`,
      )
      .run(task);
    return task;
  }

  async getTask(id: Id): Promise<Task | undefined> {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? mapTask(row) : undefined;
  }

  async listTasks(sessionId: Id): Promise<Task[]> {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as TaskRow[];
    return rows.map(mapTask);
  }

  async updateTask(id: Id, patch: TaskPatch): Promise<void> {
    const sets: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { id, updatedAt: Date.now() };
    if (patch.intentClarified !== undefined) {
      sets.push('intent_clarified = @intentClarified');
      params.intentClarified = JSON.stringify(patch.intentClarified);
    }
    if (patch.status !== undefined) {
      sets.push('status = @status');
      params.status = patch.status;
    }
    if (patch.phase !== undefined) {
      sets.push('phase = @phase');
      params.phase = patch.phase;
    }
    if (patch.plan !== undefined) {
      sets.push('plan_json = @planJson');
      params.planJson = JSON.stringify(patch.plan);
    }
    if (patch.progress !== undefined) {
      sets.push('progress = @progress');
      params.progress = patch.progress;
    }
    if ('resumeTarget' in patch) {
      sets.push('resume_target = @resumeTarget');
      params.resumeTarget = patch.resumeTarget ?? null;
    }
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  // ---- steps --------------------------------------------------------------

  async upsertStep(step: Step): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO steps (id, task_id, idx, title, goal, status, acceptance_json, weight, deps_json, started_at, ended_at)
         VALUES (@id, @taskId, @idx, @title, @goal, @status, @acceptanceJson, @weight, @depsJson, @startedAt, @endedAt)
         ON CONFLICT(id) DO UPDATE SET
           idx = excluded.idx,
           title = excluded.title,
           goal = excluded.goal,
           status = excluded.status,
           acceptance_json = excluded.acceptance_json,
           weight = excluded.weight,
           deps_json = excluded.deps_json,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at`,
      )
      .run({
        id: step.id,
        taskId: step.taskId,
        idx: step.idx,
        title: step.title,
        goal: step.goal,
        status: step.status,
        acceptanceJson: JSON.stringify(step.acceptance),
        weight: step.weight,
        depsJson: JSON.stringify(step.deps),
        startedAt: step.startedAt ?? null,
        endedAt: step.endedAt ?? null,
      });
  }

  async listSteps(taskId: Id): Promise<Step[]> {
    const rows = this.db
      .prepare('SELECT * FROM steps WHERE task_id = ? ORDER BY idx ASC')
      .all(taskId) as StepRow[];
    return rows.map(mapStep);
  }

  // ---- tool calls ---------------------------------------------------------

  async insertToolCall(call: ToolCall): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO tool_calls (id, step_id, task_id, name, input_json, output_json, status, risk,
                                 reversible, duration_ms, error, trace_id, created_at)
         VALUES (@id, @stepId, @taskId, @name, @inputJson, @outputJson, @status, @risk,
                 @reversible, @durationMs, @error, @traceId, @createdAt)`,
      )
      .run({
        id: call.id,
        stepId: call.stepId,
        taskId: call.taskId,
        name: call.name,
        inputJson: JSON.stringify(call.input),
        outputJson: call.output === undefined ? null : JSON.stringify(call.output),
        status: call.status,
        risk: call.risk,
        reversible: call.reversible ? 1 : 0,
        durationMs: call.durationMs ?? null,
        error: call.error ?? null,
        traceId: call.traceId,
        createdAt: call.createdAt,
      });
  }

  async updateToolCall(id: Id, patch: ToolCallPatch): Promise<void> {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    if (patch.output !== undefined) {
      sets.push('output_json = @outputJson');
      params.outputJson = JSON.stringify(patch.output);
    }
    if (patch.status !== undefined) {
      sets.push('status = @status');
      params.status = patch.status;
    }
    if (patch.durationMs !== undefined) {
      sets.push('duration_ms = @durationMs');
      params.durationMs = patch.durationMs;
    }
    if (patch.error !== undefined) {
      sets.push('error = @error');
      params.error = patch.error;
    }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE tool_calls SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  async listToolCalls(taskId: Id): Promise<ToolCall[]> {
    const rows = this.db
      .prepare('SELECT * FROM tool_calls WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as ToolCallRow[];
    return rows.map(mapToolCall);
  }

  // ---- messages -----------------------------------------------------------

  async appendMessage(message: Message): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO messages (id, task_id, role, content, name, tokens, compacted, created_at)
         VALUES (@id, @taskId, @role, @content, @name, @tokens, @compacted, @createdAt)`,
      )
      .run({
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        content: message.content,
        name: message.name ?? null,
        tokens: message.tokens,
        compacted: message.compacted ? 1 : 0,
        createdAt: message.createdAt,
      });
  }

  async listMessages(taskId: Id): Promise<Message[]> {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(taskId) as MessageRow[];
    return rows.map(mapMessage);
  }

  async markMessagesCompacted(ids: Id[]): Promise<void> {
    if (ids.length === 0) return;
    const stmt = this.db.prepare('UPDATE messages SET compacted = 1 WHERE id = ?');
    this.transaction(() => {
      for (const id of ids) stmt.run(id);
    });
  }

  // ---- verdicts -----------------------------------------------------------

  async insertVerdict(verdict: Verdict): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO verdicts (id, step_id, task_id, status, evidence_json, reason, created_at)
         VALUES (@id, @stepId, @taskId, @status, @evidenceJson, @reason, @createdAt)`,
      )
      .run({
        id: verdict.id,
        stepId: verdict.stepId,
        taskId: verdict.taskId,
        status: verdict.status,
        evidenceJson: JSON.stringify(verdict.evidence),
        reason: verdict.reason,
        createdAt: verdict.createdAt,
      });
  }

  async listVerdicts(taskId: Id): Promise<Verdict[]> {
    const rows = this.db
      .prepare('SELECT * FROM verdicts WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as VerdictRow[];
    return rows.map(mapVerdict);
  }

  // ---- checkpoints --------------------------------------------------------

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO checkpoints (id, task_id, step_idx, ctx_summary, fs_manifest, created_at)
         VALUES (@id, @taskId, @stepIdx, @ctxSummary, @fsManifest, @createdAt)`,
      )
      .run({
        id: checkpoint.id,
        taskId: checkpoint.taskId,
        stepIdx: checkpoint.stepIdx,
        ctxSummary: checkpoint.ctxSummary,
        fsManifest: JSON.stringify(checkpoint.fsManifest),
        createdAt: checkpoint.createdAt,
      });
  }

  async listCheckpoints(taskId: Id): Promise<Checkpoint[]> {
    const rows = this.db
      .prepare('SELECT * FROM checkpoints WHERE task_id = ? ORDER BY step_idx ASC, created_at ASC')
      .all(taskId) as CheckpointRow[];
    return rows.map(mapCheckpoint);
  }

  async latestCheckpoint(taskId: Id): Promise<Checkpoint | undefined> {
    const row = this.db
      .prepare(
        'SELECT * FROM checkpoints WHERE task_id = ? ORDER BY step_idx DESC, created_at DESC LIMIT 1',
      )
      .get(taskId) as CheckpointRow | undefined;
    return row ? mapCheckpoint(row) : undefined;
  }

  // ---- memories -----------------------------------------------------------

  async writeMemory(item: MemoryItem): Promise<void> {
    const layer = item.layer ?? (item.scope === 'global' ? 'long' : 'short');
    this.db
      .prepare(
        `INSERT INTO memories (id, scope, session_id, kind, content, keywords,
                               strength, importance, last_hit_at, ttl, hits, next_review_at,
                               retrievable, correctness, layer, evidence_json, created_at, updated_at)
         VALUES (@id, @scope, @sessionId, @kind, @content, @keywords,
                 @strength, @importance, @lastHitAt, @ttl, @hits, @nextReviewAt,
                 @retrievable, @correctness, @layer, @evidenceJson, @createdAt, @updatedAt)`,
      )
      .run({
        id: item.id,
        scope: item.scope,
        sessionId: item.sessionId ?? null,
        kind: item.kind,
        content: item.content,
        keywords: item.keywords,
        strength: clamp01(item.strength ?? 0.5),
        importance: clamp01(item.importance ?? 0.5),
        lastHitAt: item.lastHitAt ?? null,
        ttl: item.ttl ?? null,
        hits: item.hits ?? 0,
        nextReviewAt: item.nextReviewAt ?? null,
        retrievable: (item.retrievable ?? true) ? 1 : 0,
        correctness: clamp01(item.correctness ?? 0.5),
        layer,
        evidenceJson: item.evidence ? JSON.stringify(item.evidence) : null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
  }

  async searchMemories(query: MemoryQuery): Promise<MemoryItem[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.scope) {
      clauses.push('scope = @scope');
      params.scope = query.scope;
    }
    if (query.sessionId) {
      clauses.push('(session_id = @sessionId OR scope = \'global\')');
      params.sessionId = query.sessionId;
    }
    if (query.kind) {
      clauses.push('kind = @kind');
      params.kind = query.kind;
    }
    if (query.layer) {
      clauses.push('layer = @layer');
      params.layer = query.layer;
    }
    if (query.text) {
      // Token-based matching (Iteration 21): a memory hits when any meaningful
      // token of the query overlaps its content or keywords — so a recipe learned
      // for "create a todo module" is recalled for "build the todo module", not
      // only for a verbatim repeat of the exact sentence.
      const textTokens = query.text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length > 2);
      if (textTokens.length > 0) {
        const like = textTokens.map((_token, index) => `(content LIKE @textToken${index} OR keywords LIKE @textToken${index})`).join(' OR ');
        clauses.push(`(${like})`);
        textTokens.forEach((token, index) => {
          params[`textToken${index}`] = `%${token}%`;
        });
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = query.limit ?? 20;
    const rows = this.db
      .prepare(`SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT @limit`)
      .all({ ...params, limit }) as MemoryRow[];
    return rows.map(mapMemory);
  }

  async getMemory(id: Id): Promise<MemoryItem | undefined> {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? mapMemory(row) : undefined;
  }

  async updateMemory(id: Id, patch: MemoryPatch): Promise<void> {
    const sets: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { id, updatedAt: Date.now() };
    if (patch.strength !== undefined) {
      sets.push('strength = @strength');
      params.strength = clamp01(patch.strength);
    }
    if (patch.importance !== undefined) {
      sets.push('importance = @importance');
      params.importance = clamp01(patch.importance);
    }
    if (patch.lastHitAt !== undefined) {
      sets.push('last_hit_at = @lastHitAt');
      params.lastHitAt = patch.lastHitAt;
    }
    if (patch.hits !== undefined) {
      sets.push('hits = @hits');
      params.hits = patch.hits;
    }
    if (patch.nextReviewAt !== undefined) {
      sets.push('next_review_at = @nextReviewAt');
      params.nextReviewAt = patch.nextReviewAt;
    }
    if (patch.correctness !== undefined) {
      sets.push('correctness = @correctness');
      params.correctness = clamp01(patch.correctness);
    }
    if (patch.layer !== undefined) {
      sets.push('layer = @layer');
      params.layer = patch.layer;
    }
    if (patch.scope !== undefined) {
      sets.push('scope = @scope');
      params.scope = patch.scope;
    }
    if (patch.evidence !== undefined) {
      sets.push('evidence_json = @evidence');
      params.evidence = patch.evidence === null ? null : JSON.stringify(patch.evidence);
    }
    if (sets.length === 1) return;
    this.db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  async deleteMemory(id: Id): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  async listAllMemories(limit = 5_000): Promise<MemoryItem[]> {
    const rows = this.db
      .prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as MemoryRow[];
    return rows.map(mapMemory);
  }

  async appendForgetLog(entry: ForgetLogEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memory_forget_log (id, memory_id, content_snippet, reason, value, created_at)
         VALUES (@id, @memoryId, @contentSnippet, @reason, @value, @createdAt)`,
      )
      .run({
        id: entry.id,
        memoryId: entry.memoryId,
        contentSnippet: entry.contentSnippet,
        reason: entry.reason,
        value: entry.value,
        createdAt: entry.createdAt,
      });
  }

  async listForgetLog(limit = 200): Promise<ForgetLogEntry[]> {
    const rows = this.db
      .prepare('SELECT * FROM memory_forget_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as ForgetLogRow[];
    return rows.map((row) => ({
      id: row.id,
      memoryId: row.memory_id,
      contentSnippet: row.content_snippet,
      reason: row.reason,
      value: row.value,
      createdAt: row.created_at,
    }));
  }

  // ---- event log ----------------------------------------------------------

  async appendEvent(sessionId: Id | undefined, event: StoredEvent): Promise<number> {
    const info = this.db
      .prepare(
        `INSERT INTO events (session_id, task_id, type, payload, trace_id, ts)
         VALUES (@sessionId, @taskId, @type, @payload, @traceId, @ts)`,
      )
      .run({
        sessionId: sessionId ?? null,
        taskId: event.taskId ?? null,
        type: event.type,
        payload: JSON.stringify(event.payload),
        traceId: event.traceId,
        ts: event.ts,
      });
    return Number(info.lastInsertRowid);
  }

  async listEvents(query: EventQuery): Promise<StoredEvent[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.taskId) {
      clauses.push('task_id = @taskId');
      params.taskId = query.taskId;
    }
    if (query.sessionId) {
      clauses.push('session_id = @sessionId');
      params.sessionId = query.sessionId;
    }
    if (query.afterSeq !== undefined) {
      clauses.push('seq > @afterSeq');
      params.afterSeq = query.afterSeq;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = query.limit ?? 1000;
    const rows = this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY seq ASC LIMIT @limit`)
      .all({ ...params, limit }) as EventRow[];
    return rows.map((row) => ({
      seq: row.seq,
      type: row.type,
      payload: parseJson<JsonValue>(row.payload, null),
      traceId: row.trace_id,
      sessionId: row.session_id ?? undefined,
      taskId: row.task_id ?? undefined,
      ts: row.ts,
    }));
  }

  // ---- metrics ------------------------------------------------------------

  async recordMetric(record: MetricRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO metrics (task_id, name, value, count, tags_json, created_at)
         VALUES (@taskId, @name, @value, @count, @tagsJson, @createdAt)`,
      )
      .run({
        taskId: record.taskId ?? null,
        name: record.name,
        value: record.value,
        count: record.count ?? 1,
        tagsJson: JSON.stringify(record.tags ?? {}),
        createdAt: Date.now(),
      });
  }

  async listMetrics(taskId?: Id): Promise<MetricRecord[]> {
    const rows = (taskId
      ? this.db.prepare('SELECT * FROM metrics WHERE task_id = ? ORDER BY id ASC').all(taskId)
      : this.db.prepare('SELECT * FROM metrics ORDER BY id ASC').all()) as MetricRow[];
    return rows.map((row) => ({
      taskId: row.task_id ?? undefined,
      name: row.name,
      value: row.value,
      count: row.count,
      tags: parseJson<Record<string, string>>(row.tags_json, {}),
    }));
  }

  async recordFailureMode(input: { kind: string; mechanism: string; workspace: string }): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO failure_modes (id, kind, mechanism, workspace, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(newId(), input.kind, input.mechanism, input.workspace, Date.now());
  }

  async countFailureModes(workspace: string, kind?: string): Promise<number> {
    if (kind) {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM failure_modes WHERE workspace = ? AND kind = ?`)
        .get(workspace, kind) as { n: number };
      return row.n;
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM failure_modes WHERE workspace = ?`)
      .get(workspace) as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    workspace: row.workspace,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row: TaskRow): Task {
  const task: Task = {
    id: row.id,
    sessionId: row.session_id,
    intentRaw: row.intent_raw,
    status: row.status as TaskStatus,
    phase: row.phase as TaskPhase,
    progress: row.progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.intent_clarified) task.intentClarified = parseJson<ClarifiedIntent>(row.intent_clarified, undefined as never);
  if (row.plan_json) task.plan = parseJson<Plan>(row.plan_json, undefined as never);
  if (row.resume_target) task.resumeTarget = row.resume_target as TaskStatus;
  return task;
}

function mapStep(row: StepRow): Step {
  const step: Step = {
    id: row.id,
    taskId: row.task_id,
    idx: row.idx,
    title: row.title,
    goal: row.goal,
    status: row.status as Step['status'],
    acceptance: parseJson(row.acceptance_json, []),
    weight: row.weight,
    deps: parseJson(row.deps_json, []),
  };
  if (row.started_at !== null) step.startedAt = row.started_at;
  if (row.ended_at !== null) step.endedAt = row.ended_at;
  return step;
}

function mapToolCall(row: ToolCallRow): ToolCall {
  const call: ToolCall = {
    id: row.id,
    stepId: row.step_id,
    taskId: row.task_id,
    name: row.name,
    input: parseJson<JsonValue>(row.input_json, null),
    status: row.status as ToolCall['status'],
    risk: row.risk as ToolCall['risk'],
    reversible: row.reversible === 1,
    traceId: row.trace_id,
    createdAt: row.created_at,
  };
  if (row.output_json) call.output = parseJson<JsonValue>(row.output_json, null);
  if (row.duration_ms !== null) call.durationMs = row.duration_ms;
  if (row.error !== null) call.error = row.error;
  return call;
}

function mapMessage(row: MessageRow): Message {
  const message: Message = {
    id: row.id,
    taskId: row.task_id,
    role: row.role as Message['role'],
    content: row.content,
    tokens: row.tokens,
    compacted: row.compacted === 1,
    createdAt: row.created_at,
  };
  if (row.name !== null) message.name = row.name;
  return message;
}

function mapVerdict(row: VerdictRow): Verdict {
  return {
    id: row.id,
    stepId: row.step_id,
    taskId: row.task_id,
    status: row.status as Verdict['status'],
    evidence: parseJson(row.evidence_json, []),
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function mapCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    taskId: row.task_id,
    stepIdx: row.step_idx,
    ctxSummary: row.ctx_summary,
    fsManifest: parseJson<FsManifest>(row.fs_manifest, { entries: {} }),
    createdAt: row.created_at,
  };
}

function mapMemory(row: MemoryRow): MemoryItem {
  const item: MemoryItem = {
    id: row.id,
    scope: row.scope as MemoryItem['scope'],
    kind: row.kind as MemoryItem['kind'],
    content: row.content,
    keywords: row.keywords,
    strength: row.strength,
    importance: row.importance,
    hits: row.hits,
    retrievable: row.retrievable === 1,
    correctness: row.correctness,
    layer: row.layer as MemoryLayer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.session_id) item.sessionId = row.session_id;
  if (row.last_hit_at !== null) item.lastHitAt = row.last_hit_at;
  if (row.ttl !== null) item.ttl = row.ttl;
  if (row.next_review_at !== null) item.nextReviewAt = row.next_review_at;
  if (row.evidence_json) item.evidence = parseJson(row.evidence_json, null);
  return item;
}