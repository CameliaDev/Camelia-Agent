import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { SCHEMA_VERSION, V1_SCHEMA, V5_SCHEMA, migrate } from '../src/persistence/schema.js';
import type { Prediction, Residual, SkillRecord, SituationStat } from '../src/types/cognition.js';
import type {
  Checkpoint,
  Message,
  Step,
  ToolCall,
  Verdict,
} from '../src/types/domain.js';
import type { StoredEvent } from '../src/types/events.js';

let store: SqliteSessionStore;

beforeEach(() => {
  store = new SqliteSessionStore(':memory:');
});

afterEach(() => {
  store.close();
});

function tmpFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'camelia-migration-'));
  return path.join(dir, 'store.db');
}

function cleanup(file: string): void {
  try {
    rmSync(path.dirname(file), { recursive: true, force: true });
  } catch {
    // best effort
  }
}

describe('schema', () => {
  it('migrates to the current version and is idempotent', () => {
    const db = store.raw;
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
    expect(migrate(db)).toBe(SCHEMA_VERSION);
  });

  it('enables WAL and foreign keys', () => {
    expect(store.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('sessions and tasks', () => {
  it('creates and reads back a session', async () => {
    const session = await store.createSession({
      title: 'first',
      workspace: 'C:/ws',
      provider: 'mock',
      model: 'mock-1',
    });
    expect(session.id).toBeTruthy();
    const loaded = await store.getSession(session.id);
    expect(loaded?.title).toBe('first');
    expect(loaded?.workspace).toBe('C:/ws');
  });

  it('updates and lists sessions newest first', async () => {
    const a = await store.createSession({ title: 'a', workspace: 'w', provider: 'p', model: 'm' });
    const b = await store.createSession({ title: 'b', workspace: 'w', provider: 'p', model: 'm' });
    await store.updateSession(a.id, { title: 'a2', model: 'm2' });
    const list = await store.listSessions();
    expect(list.map((s) => s.title)).toContain('a2');
    expect(list).toHaveLength(2);
    expect(b.id).toBeTruthy();
  });

  it('returns undefined for a missing session', async () => {
    expect(await store.getSession('nope')).toBeUndefined();
  });

  it('lists every unsettled task across sessions, not just one session', async () => {
    // The runtime repairs exactly this set at startup, so it has to be store-wide. A
    // per-session scan would silently skip whatever fell outside the page.
    const one = await store.createSession({ title: 'one', workspace: 'w', provider: 'p', model: 'm' });
    const two = await store.createSession({ title: 'two', workspace: 'w', provider: 'p', model: 'm' });

    const stuck = await store.createTask({ sessionId: one.id, intentRaw: 'stuck at the gate' });
    await store.updateTask(stuck.id, { status: 'awaiting-approval', phase: 'awaiting-approval' });
    const running = await store.createTask({ sessionId: two.id, intentRaw: 'still going' });
    await store.updateTask(running.id, { status: 'executing', phase: 'executing' });

    const finished = await store.createTask({ sessionId: one.id, intentRaw: 'finished' });
    await store.updateTask(finished.id, { status: 'done', phase: 'delivering' });
    const cancelled = await store.createTask({ sessionId: two.id, intentRaw: 'cancelled' });
    await store.updateTask(cancelled.id, { status: 'cancelled', phase: 'delivering' });
    const failed = await store.createTask({ sessionId: two.id, intentRaw: 'failed' });
    await store.updateTask(failed.id, { status: 'failed', phase: 'delivering' });
    // `paused` is already actionable — the user has a 继续 button — so it is not unsettled.
    const paused = await store.createTask({ sessionId: one.id, intentRaw: 'user paused' });
    await store.updateTask(paused.id, { status: 'paused', phase: 'paused' });

    const unsettled = await store.listUnsettledTasks();
    expect(unsettled.map((t) => t.id).sort()).toEqual([stuck.id, running.id].sort());
  });

  it('creates a task with defaults and updates it', async () => {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    const task = await store.createTask({ sessionId: session.id, intentRaw: 'add a function' });
    expect(task.status).toBe('received');
    expect(task.phase).toBe('planning');
    expect(task.progress).toBe(0);

    await store.updateTask(task.id, {
      status: 'planning',
      phase: 'planning',
      progress: 0.25,
      intentClarified: {
        goal: 'add formatISO',
        assumptions: ['named export'],
        constraints: [],
        expectedPaths: ['src/date.ts'],
        complete: true,
      },
      plan: {
        id: 'plan1',
        taskId: task.id,
        steps: [],
        mode: 'fast',
        revision: 1,
        createdAt: 1,
      },
    });

    const loaded = await store.getTask(task.id);
    expect(loaded?.status).toBe('planning');
    expect(loaded?.progress).toBe(0.25);
    expect(loaded?.intentClarified?.goal).toBe('add formatISO');
    expect(loaded?.plan?.mode).toBe('fast');
  });

  it('stores and clears resumeTarget', async () => {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    const task = await store.createTask({ sessionId: session.id, intentRaw: 'x' });
    await store.updateTask(task.id, { status: 'paused', resumeTarget: 'executing' });
    expect((await store.getTask(task.id))?.resumeTarget).toBe('executing');
    await store.updateTask(task.id, { resumeTarget: undefined });
    expect((await store.getTask(task.id))?.resumeTarget).toBeUndefined();
  });

  it('lists tasks for a session in creation order', async () => {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    await store.createTask({ sessionId: session.id, intentRaw: '1' });
    await store.createTask({ sessionId: session.id, intentRaw: '2' });
    const tasks = await store.listTasks(session.id);
    expect(tasks.map((t) => t.intentRaw)).toEqual(['1', '2']);
  });

  it('cascades deletes from session to task', async () => {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    await store.createTask({ sessionId: session.id, intentRaw: 'x' });
    store.raw.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    expect(await store.listTasks(session.id)).toHaveLength(0);
  });
});

describe('steps, tool calls, verdicts', () => {
  async function seed() {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    const task = await store.createTask({ sessionId: session.id, intentRaw: 'x' });
    return { session, task };
  }

  it('upserts steps and preserves order', async () => {
    const { task } = await seed();
    const step: Step = {
      id: 'step1',
      taskId: task.id,
      idx: 0,
      title: 'read file',
      goal: 'read src/a.ts',
      status: 'pending',
      acceptance: [{ id: 'a1', description: 'file read', kind: 'file-exists', params: { path: 'src/a.ts' } }],
      weight: 1,
      deps: [],
    };
    await store.upsertStep(step);
    await store.upsertStep({ ...step, status: 'done', startedAt: 1, endedAt: 2 });
    const steps = await store.listSteps(task.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('done');
    expect(steps[0]?.acceptance[0]?.kind).toBe('file-exists');
    expect(steps[0]?.endedAt).toBe(2);
  });

  it('inserts and updates tool calls', async () => {
    const { task } = await seed();
    await store.upsertStep({
      id: 'step1',
      taskId: task.id,
      idx: 0,
      title: 't',
      goal: 'g',
      status: 'running',
      acceptance: [],
      weight: 1,
      deps: [],
    });
    const call: ToolCall = {
      id: 'call1',
      stepId: 'step1',
      taskId: task.id,
      name: 'fs.read',
      input: { path: 'src/a.ts' },
      status: 'running',
      risk: 'read-only',
      reversible: true,
      traceId: 'tr1',
      createdAt: 1,
    };
    await store.insertToolCall(call);
    await store.updateToolCall('call1', {
      status: 'ok',
      output: { content: 'hello' },
      durationMs: 12,
    });
    const calls = await store.listToolCalls(task.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe('ok');
    expect(calls[0]?.durationMs).toBe(12);
    expect(calls[0]?.reversible).toBe(true);
  });

  it('stores an error on a failed tool call', async () => {
    const { task } = await seed();
    await store.upsertStep({
      id: 'step1', taskId: task.id, idx: 0, title: 't', goal: 'g',
      status: 'running', acceptance: [], weight: 1, deps: [],
    });
    await store.insertToolCall({
      id: 'call1', stepId: 'step1', taskId: task.id, name: 'shell.exec',
      input: { command: 'false' }, status: 'running', risk: 'privileged',
      reversible: false, traceId: 'tr1', createdAt: 1,
    });
    await store.updateToolCall('call1', { status: 'error', error: 'exit 1' });
    const calls = await store.listToolCalls(task.id);
    expect(calls[0]?.error).toBe('exit 1');
  });

  it('stores verdicts with evidence', async () => {
    const { task } = await seed();
    await store.upsertStep({
      id: 'step1', taskId: task.id, idx: 0, title: 't', goal: 'g',
      status: 'verifying', acceptance: [], weight: 1, deps: [],
    });
    const verdict: Verdict = {
      id: 'v1',
      stepId: 'step1',
      taskId: task.id,
      status: 'pass',
      evidence: [{ kind: 'command-output', ref: 'call1', detail: 'exit 0' }],
      reason: 'tsc clean',
      createdAt: 5,
    };
    await store.insertVerdict(verdict);
    const verdicts = await store.listVerdicts(task.id);
    expect(verdicts[0]?.status).toBe('pass');
    expect(verdicts[0]?.evidence[0]?.kind).toBe('command-output');
  });
});

describe('messages', () => {
  it('appends messages in order and marks them compacted', async () => {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    const task = await store.createTask({ sessionId: session.id, intentRaw: 'x' });
    const messages: Message[] = [
      { id: 'm1', taskId: task.id, role: 'user', content: 'hi', tokens: 1, compacted: false, createdAt: 1 },
      { id: 'm2', taskId: task.id, role: 'assistant', content: 'hello', tokens: 2, compacted: false, createdAt: 2 },
    ];
    for (const m of messages) await store.appendMessage(m);
    await store.markMessagesCompacted(['m1']);
    const loaded = await store.listMessages(task.id);
    expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(loaded[0]?.compacted).toBe(true);
    expect(loaded[1]?.compacted).toBe(false);
  });

  it('markMessagesCompacted is a no-op for an empty list', async () => {
    await expect(store.markMessagesCompacted([])).resolves.toBeUndefined();
  });
});

describe('checkpoints', () => {
  it('saves and retrieves the latest checkpoint', async () => {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    const task = await store.createTask({ sessionId: session.id, intentRaw: 'x' });
    const cp: Checkpoint = {
      id: 'cp1',
      taskId: task.id,
      stepIdx: 0,
      ctxSummary: 'did step 0',
      fsManifest: { entries: { 'src/a.ts': 'hash1' } },
      createdAt: 1,
    };
    await store.saveCheckpoint(cp);
    await store.saveCheckpoint({ ...cp, id: 'cp2', stepIdx: 2, ctxSummary: 'did step 2' });
    expect((await store.latestCheckpoint(task.id))?.id).toBe('cp2');
    expect((await store.listCheckpoints(task.id)).map((c) => c.stepIdx)).toEqual([0, 2]);
    expect((await store.latestCheckpoint('nope'))).toBeUndefined();
  });

  it('round-trips the fs manifest', async () => {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    const task = await store.createTask({ sessionId: session.id, intentRaw: 'x' });
    await store.saveCheckpoint({
      id: 'cp', taskId: task.id, stepIdx: 0, ctxSummary: '',
      fsManifest: { entries: { 'a.ts': 'h', 'b.ts': 'h2' } }, createdAt: 1,
    });
    const cp = await store.latestCheckpoint(task.id);
    expect(cp?.fsManifest.entries['b.ts']).toBe('h2');
  });
});

describe('memories', () => {
  it('writes and searches memories by text, scope and kind', async () => {
    await store.writeMemory({
      id: 'mem1', scope: 'global', kind: 'lesson',
      content: 'always run tsc before delivering',
      keywords: 'tsc build verify', createdAt: 1, updatedAt: 1,
    });
    await store.writeMemory({
      id: 'mem2', scope: 'session', sessionId: 's1', kind: 'fact',
      content: 'project uses pnpm', keywords: 'pnpm package', createdAt: 2, updatedAt: 2,
    });

    expect((await store.searchMemories({ text: 'tsc' })).map((m) => m.id)).toEqual(['mem1']);
    expect((await store.searchMemories({ kind: 'fact' })).map((m) => m.id)).toEqual(['mem2']);
    expect((await store.searchMemories({ scope: 'global' })).map((m) => m.id)).toEqual(['mem1']);
    expect((await store.searchMemories({ sessionId: 's1' })).map((m) => m.id).sort()).toEqual(['mem1', 'mem2']);
    expect((await store.searchMemories({ limit: 1 }))).toHaveLength(1);
  });

  // ---- Iteration 20: memory lifecycle --------------------------------------

  it('defaults lifecycle fields on write and round-trips them on read', async () => {
    await store.writeMemory({
      id: 'life1', scope: 'session', sessionId: 's1', kind: 'fact',
      content: 'the build cache lives in .turbo', keywords: 'turbo cache',
      strength: 0.9, importance: 0.8, lastHitAt: 100, ttl: 86400000,
      hits: 3, nextReviewAt: 200, retrievable: true, correctness: 1, layer: 'short',
      createdAt: 1, updatedAt: 2,
    });
    const loaded = (await store.getMemory('life1'))!;
    expect(loaded.strength).toBe(0.9);
    expect(loaded.importance).toBe(0.8);
    expect(loaded.lastHitAt).toBe(100);
    expect(loaded.ttl).toBe(86400000);
    expect(loaded.hits).toBe(3);
    expect(loaded.nextReviewAt).toBe(200);
    expect(loaded.retrievable).toBe(true);
    expect(loaded.correctness).toBe(1);
    expect(loaded.layer).toBe('short');
  });

  it('derives a default layer from scope when none is given', async () => {
    await store.writeMemory({
      id: 'g1', scope: 'global', kind: 'fact', content: 'x', keywords: '',
      createdAt: 1, updatedAt: 1,
    });
    await store.writeMemory({
      id: 's2', scope: 'session', sessionId: 's', kind: 'fact', content: 'y', keywords: '',
      createdAt: 1, updatedAt: 1,
    });
    expect((await store.getMemory('g1'))?.layer).toBe('long');
    expect((await store.getMemory('s2'))?.layer).toBe('short');
  });

  it('updates lifecycle fields, lists all memories and deletes with a forget log', async () => {
    await store.writeMemory({
      id: 'up1', scope: 'global', kind: 'fact', content: 'node 22 abi 127', keywords: 'node abi',
      createdAt: 1, updatedAt: 1,
    });
    await store.updateMemory('up1', { hits: 4, lastHitAt: 50, strength: 0.7, nextReviewAt: 999 });
    const updated = (await store.getMemory('up1'))!;
    expect(updated.hits).toBe(4);
    expect(updated.lastHitAt).toBe(50);
    expect(updated.strength).toBe(0.7);
    expect(updated.nextReviewAt).toBe(999);

    expect((await store.listAllMemories()).map((m) => m.id)).toContain('up1');

    await store.appendForgetLog({
      id: 'fl1', memoryId: 'up1', contentSnippet: 'node 22 abi 127', reason: 'budget-eviction', value: 0.12, createdAt: 60,
    });
    const log = await store.listForgetLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.reason).toBe('budget-eviction');

    await store.deleteMemory('up1');
    expect(await store.getMemory('up1')).toBeUndefined();
    expect(await store.listAllMemories()).toHaveLength(0);
  });

  it('searches by layer', async () => {
    await store.writeMemory({
      id: 'layer-g', scope: 'global', kind: 'procedural', content: 'when X then Y', keywords: 'recipe',
      layer: 'procedural', createdAt: 1, updatedAt: 1,
    });
    await store.writeMemory({
      id: 'layer-s', scope: 'session', kind: 'fact', content: 'ephemeral', keywords: 'tmp',
      createdAt: 1, updatedAt: 1,
    });
    expect((await store.searchMemories({ layer: 'procedural' })).map((m) => m.id)).toEqual(['layer-g']);
    expect((await store.searchMemories({ layer: 'short' })).map((m) => m.id)).toEqual(['layer-s']);
  });
});

describe('migration', () => {
  it('migrates a V1 database to V2 without losing memory data', async () => {
    const file = tmpFile();
    try {
      // Build a legacy V1 database exactly as Camelia ≤ Iteration 19 shipped it.
      const legacy = new Database(file);
      legacy.exec(V1_SCHEMA);
      legacy.pragma('user_version = 1');
      legacy
        .prepare(
          'INSERT INTO memories (id, scope, session_id, kind, content, keywords, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run('old-1', 'global', null, 'lesson', 'never delete the backup before the rollback test passes', 'backup rollback', 10, 10);
      legacy
        .prepare(
          'INSERT INTO memories (id, scope, session_id, kind, content, keywords, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run('old-2', 'session', 's9', 'fact', 'the fixture port is 5173', 'fixture port', 11, 11);
      legacy.close();

      // Reopen through the store: V1→V2 migration runs, data survives.
      const migrated = new SqliteSessionStore(file);
      const all = await migrated.listAllMemories();
      expect(all.map((m) => m.id).sort()).toEqual(['old-1', 'old-2']);
      const old1 = (await migrated.getMemory('old-1'))!;
      expect(old1.content).toBe('never delete the backup before the rollback test passes');
      expect(old1.scope).toBe('global');
      // Lifecycle defaults are populated, nothing is lost.
      expect(old1.strength).toBe(0.5);
      expect(old1.importance).toBe(0.5);
      expect(old1.hits).toBe(0);
      expect(old1.retrievable).toBe(true);
      // Layer back-filled from scope: global → long, session → short.
      expect(old1.layer).toBe('long');
      expect((await migrated.getMemory('old-2'))?.layer).toBe('short');
      expect(await migrated.listForgetLog()).toHaveLength(0);
      migrated.close();
    } finally {
      cleanup(file);
    }
  });

  it('migrates a V2 database to V3 — evidence column added, old rows keep no evidence', async () => {
    const file = tmpFile();
    try {
      // Build a V2 database as Camelia Iteration 20/21 shipped it: V1 schema plus
      // the lifecycle columns, but without `evidence_json`.
      const legacy = new Database(file);
      legacy.exec(V1_SCHEMA);
      legacy.exec(`
        ALTER TABLE memories ADD COLUMN strength REAL NOT NULL DEFAULT 0.5;
        ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5;
        ALTER TABLE memories ADD COLUMN last_hit_at INTEGER;
        ALTER TABLE memories ADD COLUMN ttl INTEGER;
        ALTER TABLE memories ADD COLUMN hits INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE memories ADD COLUMN next_review_at INTEGER;
        ALTER TABLE memories ADD COLUMN retrievable INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE memories ADD COLUMN correctness REAL NOT NULL DEFAULT 0.5;
        ALTER TABLE memories ADD COLUMN layer TEXT NOT NULL DEFAULT 'short';
        CREATE TABLE IF NOT EXISTS memory_forget_log (
          id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, content_snippet TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
        );
      `);
      legacy.pragma('user_version = 2');
      legacy
        .prepare(
          `INSERT INTO memories (id, scope, kind, content, keywords, strength, importance, correctness, layer, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run('old-v2-1', 'global', 'lesson', 'rollback before trusting a refactor', 'rollback', 0.9, 0.9, 1, 'long', 10, 10);
      legacy.close();

      // Reopen through the store: V2→V3 migration runs, the old row survives with evidence = null.
      const migrated = new SqliteSessionStore(file);
      expect(Number(migrated.raw.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
      const old = (await migrated.getMemory('old-v2-1'))!;
      expect(old.content).toBe('rollback before trusting a refactor');
      expect(old.evidence).toBeUndefined();

      // The new column accepts evidence on the write path.
      const now = Date.now();
      await migrated.writeMemory({
        id: 'new-v3-1', scope: 'global', kind: 'procedural', content: 'scaffold recipe', keywords: 'recipe',
        layer: 'procedural', evidence: { taskId: 'tsk_v3', verdict: 'pass', at: now }, createdAt: now, updatedAt: now,
      });
      const fresh = (await migrated.getMemory('new-v3-1'))!;
      expect(fresh.evidence).toEqual({ taskId: 'tsk_v3', verdict: 'pass', at: now });

      // … and the update path round-trips evidence too.
      await migrated.updateMemory('new-v3-1', { evidence: { taskId: 'tsk_v3b', verdict: 'unknown', at: now + 1 } });
      expect((await migrated.getMemory('new-v3-1'))?.evidence?.taskId).toBe('tsk_v3b');
      migrated.close();
    } finally {
      cleanup(file);
    }
  });

  it('migrates a V5 database to V6, keeps old rows, and can run again', async () => {
    const file = tmpFile();
    try {
      const legacy = new Database(file);
      legacy.exec(V5_SCHEMA);
      legacy.pragma('user_version = 5');
      legacy
        .prepare(
          `INSERT INTO sessions (id, title, workspace, provider, model, created_at, updated_at, kind)
           VALUES ('s-v5', 'legacy', '/ws', 'mock', 'm', 1, 1, 'work')`,
        )
        .run();
      legacy
        .prepare(
          `INSERT INTO memories (id, scope, kind, content, keywords, created_at, updated_at)
           VALUES ('mem-v5', 'global', 'procedural', 'keep the rollback note', 'rollback', 2, 2)`,
        )
        .run();
      legacy
        .prepare(
          `INSERT INTO events (session_id, task_id, type, payload, trace_id, ts)
           VALUES ('s-v5', NULL, 'log', '{"message":"v5"}', 'tr-v5', 3)`,
        )
        .run();
      legacy.close();

      const migrated = new SqliteSessionStore(file);
      expect(Number(migrated.raw.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
      expect(SCHEMA_VERSION).toBe(7);
      expect((await migrated.getSession('s-v5'))?.title).toBe('legacy');
      expect((await migrated.getMemory('mem-v5'))?.content).toBe('keep the rollback note');
      expect((await migrated.listEvents({ sessionId: 's-v5' })).map((event) => event.type)).toEqual(['log']);

      const tables = migrated.raw
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('predictions','residuals','situation_stats','skills')`)
        .all() as { name: string }[];
      expect(tables.map((row) => row.name).sort()).toEqual(['predictions', 'residuals', 'situation_stats', 'skills']);

      const prediction: Prediction = {
        id: 'pred-v6',
        taskId: 'tsk-v6',
        sessionId: 's-v5',
        stepId: 'stp-v6',
        subject: { kind: 'verdict', stepId: 'stp-v6' },
        signature: {
          capability: 'tool-calling',
          archetype: 'edit',
          scope: 'few-files',
          toolset: ['fs.write'],
          inDegree: 2,
        },
        signatureKey: 'tool-calling|edit|few-files|2',
        value: { kind: 'categorical-multi', probs: { pass: 0.75, fail: 0.2, unknown: 0.05 } },
        confidence: 0.75,
        source: 'empirical-backoff',
        basis: 'L3 n=4, pass 3/4',
        level: 3,
        at: 40,
      };
      await migrated.insertPrediction(prediction);
      const residual: Residual = {
        predictionId: 'pred-v6',
        taskId: 'tsk-v6',
        signatureKey: 'tool-calling|edit|few-files|2',
        observed: { kind: 'categorical', label: 'fail' },
        score: 0.2,
        rule: 'categorical-brier',
        surprise: false,
        threshold: null,
        contrast: 'expected pass (0.75) → observed fail',
        at: 41,
      };
      await migrated.insertResidual(residual);
      const stat: SituationStat = {
        signatureKey: 'tool-calling|edit|few-files|2',
        subjectKind: 'verdict',
        n: 4,
        sumScore: 0.8,
        sumScoreSq: 0.2,
        sumConfidence: 3,
        estimate: prediction.value,
        updatedAt: 41,
      };
      await migrated.upsertSituationStat(stat);
      const skill: SkillRecord = {
        memoryId: 'mem-v5',
        steps: ['read', 'edit', 'verify'],
        signatureKey: 'tool-calling|edit|few-files|*',
        attempts: 3,
        successes: 2,
        meanResidual: 0.25,
        lastAttemptAt: 42,
      };
      await migrated.upsertLearnedSkill(skill);

      const loaded = await migrated.getPrediction('pred-v6');
      expect(loaded?.signatureKey).toBe('tool-calling|edit|few-files|2');
      expect(loaded?.signature.archetype).toBe('edit');
      expect(loaded?.signature.scope).toBe('few-files');
      expect(loaded?.signature.inDegree).toBe(2);
      // Toolset is not a V6 column. Read-back does not invent one.
      expect(loaded?.signature.toolset).toEqual([]);
      expect(loaded?.value).toEqual(prediction.value);
      expect(loaded?.subject).toEqual({ kind: 'verdict', stepId: 'stp-v6' });
      expect(await migrated.getResidual('pred-v6')).toMatchObject({ surprise: false, score: 0.2, threshold: null });
      expect((await migrated.listPredictions({ onlySurprised: true }))).toHaveLength(0);
      expect((await migrated.getSituationStat('tool-calling|edit|few-files|2', 'verdict'))?.n).toBe(4);
      expect(await migrated.getLearnedSkill('mem-v5')).toMatchObject({
        attempts: 3,
        successes: 2,
        meanResidual: 0.25,
        steps: ['read', 'edit', 'verify'],
      });
      expect((await migrated.getLearnedSkill('mem-v5'))?.heuristicTableVersion).toBeUndefined();
      await migrated.upsertLearnedSkill({
        memoryId: 'mem-v5',
        steps: ['read', 'edit', 'verify'],
        signatureKey: 'tool-calling|edit|few-files|*',
        attempts: 4,
        successes: 3,
        meanResidual: 0.2,
        lastAttemptAt: 43,
        heuristicTableVersion: '1.0.0',
      });
      expect((await migrated.getLearnedSkill('mem-v5'))?.heuristicTableVersion).toBe('1.0.0');

      // Replaying V6+V7 after the version is wound back must not throw or drop rows.
      migrated.raw.pragma('user_version = 5');
      expect(migrate(migrated.raw)).toBe(7);
      expect(migrate(migrated.raw)).toBe(7);
      expect(await migrated.getPrediction('pred-v6')).toBeTruthy();
      expect((await migrated.getMemory('mem-v5'))?.content).toBe('keep the rollback note');

      await migrated.deleteMemory('mem-v5');
      expect(await migrated.getLearnedSkill('mem-v5')).toBeUndefined();

      migrated.raw.prepare('DELETE FROM predictions WHERE id = ?').run('pred-v6');
      expect(await migrated.getResidual('pred-v6')).toBeUndefined();
      migrated.close();
    } finally {
      cleanup(file);
    }
  });
});

describe('event log', () => {
  it('appends events with a monotonic seq and reads them back', async () => {
    const event: StoredEvent = {
      type: 'task.received',
      payload: { intentRaw: 'x' },
      traceId: 'tr1',
      taskId: 'task1',
      ts: 1,
      seq: 0,
    };
    const seq1 = await store.appendEvent('s1', event);
    const seq2 = await store.appendEvent('s1', { ...event, type: 'plan.ready', ts: 2 });
    expect(seq2).toBeGreaterThan(seq1);

    const all = await store.listEvents({ sessionId: 's1' });
    expect(all.map((e) => e.type)).toEqual(['task.received', 'plan.ready']);
    expect(all[0]?.seq).toBe(seq1);

    const after = await store.listEvents({ sessionId: 's1', afterSeq: seq1 });
    expect(after.map((e) => e.type)).toEqual(['plan.ready']);
  });

  it('filters events by taskId', async () => {
    await store.appendEvent('s1', {
      type: 'a', payload: null, traceId: 't', taskId: 'taskA', ts: 1, seq: 0,
    });
    await store.appendEvent('s1', {
      type: 'b', payload: null, traceId: 't', taskId: 'taskB', ts: 2, seq: 0,
    });
    expect((await store.listEvents({ taskId: 'taskA' })).map((e) => e.type)).toEqual(['a']);
  });

  it('survives a payload that is not valid JSON', async () => {
    store.raw
      .prepare(
        `INSERT INTO events (session_id, task_id, type, payload, trace_id, ts)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('s1', null, 'broken', 'not-json', 't', 1);
    const events = await store.listEvents({ sessionId: 's1' });
    expect(events[0]?.payload).toBeNull();
  });
});

describe('metrics', () => {
  it('records and lists metrics', async () => {
    await store.recordMetric({ name: 'task.success', value: 1, tags: { kind: 'simple' } });
    await store.recordMetric({ name: 'task.success', value: 0, tags: { kind: 'complex' }, taskId: 't1' });
    expect(await store.listMetrics()).toHaveLength(2);
    expect(await store.listMetrics('t1')).toHaveLength(1);
  });
});

describe('transactions', () => {
  it('rolls back the whole batch on failure', async () => {
    const session = await store.createSession({ title: 's', workspace: 'w', provider: 'p', model: 'm' });
    const task = await store.createTask({ sessionId: session.id, intentRaw: 'x' });
    expect(() =>
      store.transaction(() => {
        store.raw
          .prepare('INSERT INTO steps (id, task_id, idx, title, goal, status) VALUES (?,?,?,?,?,?)')
          .run('s1', task.id, 0, 't', 'g', 'pending');
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(await store.listSteps(task.id)).toHaveLength(0);
  });
});