/**
 * The composition root, end to end (whitepaper §7, §9.3).
 *
 * These tests drive `CameliaRuntime` exactly as `camelia run` does, with the
 * scripted provider standing in for a model: real files, real SQLite, real events,
 * real approval decisions. This is the Phase 1 acceptance surface.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ChatChunk, ChatRequest, LLMPort } from '@camelia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CameliaRuntime } from '../src/runtime/CameliaRuntime.js';
import type { ProviderHandle } from '../src/ProviderRegistry.js';
import { MockProvider } from '../src/providers/MockProvider.js';
import { scriptedTaskScript, type ScriptedTaskSpec } from '../src/providers/ScriptedAgentProvider.js';

interface Harness {
  runtime: CameliaRuntime;
  workspace: string;
}

const runtimes: CameliaRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.close().catch(() => undefined)));
  vi.unstubAllEnvs();
});

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A scripted provider handle that notifies a hook before each model call. */
function scriptedHandle(spec: ScriptedTaskSpec, onCall?: (callIndex: number) => void): ProviderHandle {
  const inner = new MockProvider({ id: 'mock', models: ['scripted'], script: scriptedTaskScript(spec) });
  const port: LLMPort = {
    id: 'mock',
    capabilities: () => inner.capabilities(),
    listModels: () => inner.listModels(),
    async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
      onCall?.(inner.calls);
      yield* inner.chat(request, signal);
    },
  };
  return { id: 'mock', label: 'Scripted mock', model: 'scripted', models: ['scripted'], port };
}

async function harness(
  spec: ScriptedTaskSpec,
  options: { autoApprove?: boolean; onCall?: (callIndex: number) => void } = {},
): Promise<Harness> {
  const workspace = tempDir('camelia-ws-');
  const home = tempDir('camelia-home-');
  vi.stubEnv('CAMELIA_HOME', home);
  const runtime = await CameliaRuntime.create({
    workspace,
    providerHandles: [scriptedHandle(spec, options.onCall)],
    databaseFile: ':memory:',
    autoApprove: options.autoApprove ?? true,
    // Tool-approval tests are not the plan gate. The product default stays `always`.
    planApproval: 'auto',
    logLevel: 'error',
    logTo: () => undefined,
  });
  runtimes.push(runtime);
  return { runtime, workspace };
}

// ---------------------------------------------------------------------------

describe('CameliaRuntime — a completed task', () => {
  it('creates the file, runs the acceptance command and reports done', async () => {
    const { runtime, workspace } = await harness({
      create: { 'a.ts': 'export const a = 1;\n' },
      commands: ['node --version'],
    });

    const result = await runtime.run('create a.ts with a constant');

    expect(result.outcome.status).toBe('done');
    expect(result.outcome.stepsCompleted).toBe(2);
    expect(result.outcome.stepsTotal).toBe(2);
    expect(result.outcome.unverifiedSteps).toBe(0);
    expect(fs.readFileSync(path.join(workspace, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('reports the file as a deliverable artifact', async () => {
    const { runtime } = await harness({ create: { 'docs/note.md': '# hi\n' } });
    const result = await runtime.run('write a note');
    const files = result.outcome.artifacts.filter((a) => a.kind === 'file').map((a) => a.path);
    expect(files).toContain('docs/note.md');
  });

  it('applies an edit to an existing file', async () => {
    const { runtime, workspace } = await harness({ edit: { 'a.ts': { oldText: 'old', newText: 'new' } } });
    fs.writeFileSync(path.join(workspace, 'a.ts'), 'const x = "old";\n');
    const result = await runtime.run('rename old to new');
    expect(result.outcome.status).toBe('done');
    expect(fs.readFileSync(path.join(workspace, 'a.ts'), 'utf8')).toBe('const x = "new";\n');
  });

  it('records the goal in the protected context slots', async () => {
    const { runtime } = await harness({ create: { 'a.ts': 'x' } });
    const result = await runtime.run('create a.ts');
    expect(result.context.slots.goal).toBeTruthy();
    expect(result.context.slots.artifacts).toContain('a.ts');
  });

  it('reports the provider chain and routing decision', async () => {
    const { runtime } = await harness({ create: { 'a.ts': 'x' } });
    const result = await runtime.run('create a.ts');
    expect(result.provider.id).toBe('mock');
    expect(result.provider.chain.map((c) => c.id)).toEqual(['mock']);
    expect(result.provider.depth).toBe(0);
    expect(runtime.modelInfo.model).toBe('scripted');
    expect(runtime.routingReason).toContain('heuristic');
  });
});

describe('CameliaRuntime — persistence and audit', () => {
  it('writes a durable event log that can be replayed', async () => {
    const { runtime } = await harness({ create: { 'a.ts': 'x' }, commands: ['node --version'] });
    const result = await runtime.run('create a.ts');
    await runtime.flush();

    const events = await runtime.replay(result.task.id);
    const types = events.map((e) => e.type);
    expect(types).toContain('task.received');
    expect(types).toContain('plan.started');
    expect(types).toContain('step.completed');
    expect(types).toContain('task.completed');
    // The log is ordered and correlated to the task.
    expect(events.every((e) => e.taskId === result.task.id)).toBe(true);
  });

  it('persists the task as done with the completed plan', async () => {
    const { runtime } = await harness({ create: { 'a.ts': 'x' } });
    const result = await runtime.run('create a.ts');
    const task = await runtime.store.getTask(result.task.id);
    expect(task?.status).toBe('done');
    expect(task?.plan?.steps.length).toBeGreaterThan(0);
  });

  it('writes a reflection memory for the session', async () => {
    const { runtime } = await harness({ create: { 'a.ts': 'x' } });
    await runtime.run('create a.ts');
    const memories = await runtime.store.searchMemories({ sessionId: runtime.session.id });
    expect(memories.some((m) => m.kind === 'artifact')).toBe(true);
  });

  it('persists self-review and memory events in the durable log, in order (Iteration 21)', async () => {
    const { runtime } = await harness({ create: { 'a.ts': 'x' }, commands: ['node --version'] });
    const result = await runtime.run('create a.ts');
    await runtime.flush();

    const events = await runtime.replay(result.task.id);
    const types = events.map((e) => e.type);
    // The decision-path events of Iteration 20/21 are durable and replayable.
    expect(types).toContain('selfreview.skipped'); // 2-step plan → fast-path skip, still observable
    expect(types).toContain('memory.recalled');   // planning recall (0 hits on a fresh store)
    expect(types).toContain('memory.written');    // reflection write
    // In order, correlated to the task: planning recall precedes reflection write.
    expect(events.every((e) => e.taskId === result.task.id)).toBe(true);
    const seqs = events.map((e) => e.seq);
    expect(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!)).toBe(true);
    expect(types.indexOf('memory.recalled')).toBeLessThan(types.indexOf('memory.written'));
  });

  it('keeps a procedural recipe alive across sessions — written in session 1, recalled with provenance in session 2', async () => {
    const db = path.join(tempDir('camelia-db-'), 'camelia.db');
    const home1 = tempDir('camelia-home1-');
    vi.stubEnv('CAMELIA_HOME', home1);
    // Session 1: a 3-step task writes a global procedural memory at reflection.
    const r1 = await CameliaRuntime.create({
      workspace: tempDir('camelia-ws1-'),
      providerHandles: [scriptedHandle({ create: { 'a.ts': 'x', 'b.ts': 'y', 'c.ts': 'z' } })],
      databaseFile: db,
      autoApprove: true,
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(r1);
    const r1result = await r1.run('create the todo module scaffold');
    expect(r1result.outcome.status).toBe('done');
    expect(r1result.outcome.stepsTotal).toBe(3);
    const recipe = (await r1.store.listAllMemories()).find((m) => m.kind === 'procedural');
    expect(recipe).toBeTruthy();
    expect(recipe!.scope).toBe('global');
    expect(recipe!.layer).toBe('procedural');
    const artifact = (await r1.store.listAllMemories()).find((m) => m.kind === 'artifact');
    expect(artifact).toBeTruthy();
    await r1.close(); // a new "process" starts against the same database file

    // Session 2: a related (not verbatim) goal hits the recipe via recall.
    const home2 = tempDir('camelia-home2-');
    vi.stubEnv('CAMELIA_HOME', home2);
    const r2 = await CameliaRuntime.create({
      workspace: tempDir('camelia-ws2-'),
      providerHandles: [scriptedHandle({ create: { 'a.ts': 'x' } })],
      databaseFile: db,
      autoApprove: true,
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(r2);
    const r2result = await r2.run('build the todo module with tests');
    expect(r2result.outcome.status).toBe('done');

    // The recipe survived the restart and is still queryable.
    const stillThere = (await r2.store.listAllMemories()).find((m) => m.id === recipe!.id);
    expect(stillThere).toBeTruthy();

    // The recall event carries provenance: which memory, which layer, why.
    const events = await r2.replay(r2result.task.id);
    const recalled = events.find((e) => e.type === 'memory.recalled');
    expect(recalled).toBeTruthy();
    const payload = recalled!.payload as { ids: string[]; provenance: { memoryId: string; layer: string; matchedBy: string }[] };
    expect(payload.ids).toContain(recipe!.id);
    const entry = payload.provenance.find((p) => p.memoryId === recipe!.id);
    expect(entry).toBeTruthy();
    expect(entry!.layer).toBe('procedural');
    expect(entry!.matchedBy.length).toBeGreaterThan(0); // hit because the problem class matched

    // Session-scoped short-term memories of session 1 are invisible to session 2:
    // only global/procedural knowledge survives the session boundary.
    expect(payload.ids).not.toContain(artifact!.id);
  });
});

describe('CameliaRuntime — user control', () => {
  it('pauses at a step boundary and reports where to resume', async () => {
    let runtimeRef: CameliaRuntime | undefined;
    const { runtime } = await harness(
      { create: { 'a.ts': 'x' }, commands: ['node --version'] },
      { onCall: (callIndex) => { if (callIndex === 2) runtimeRef?.pause('user asked'); } },
    );
    runtimeRef = runtime;

    const result = await runtime.run('create a.ts');
    expect(result.outcome.status).toBe('paused');
    expect(result.outcome.stepsCompleted).toBe(1);
    expect(result.outcome.resumeStepIdx).toBe(1);
  });

  it('cancels and reports cancelled', async () => {
    let runtimeRef: CameliaRuntime | undefined;
    const { runtime } = await harness(
      { create: { 'a.ts': 'x' }, commands: ['node --version'] },
      { onCall: (callIndex) => { if (callIndex === 2) runtimeRef?.cancel('user cancelled'); } },
    );
    runtimeRef = runtime;

    const result = await runtime.run('create a.ts');
    expect(result.outcome.status).toBe('cancelled');
  });

  it('applies a mid-task goal change at the next step boundary', async () => {
    let runtimeRef: CameliaRuntime | undefined;
    const { runtime } = await harness(
      { create: { 'a.ts': 'x' }, commands: ['node --version'] },
      { onCall: (callIndex) => { if (callIndex === 2) runtimeRef?.intervene('also add a changelog'); } },
    );
    runtimeRef = runtime;

    const result = await runtime.run('create a.ts');
    expect(result.outcome.status).toBe('done');
    const intervened = result.events.find((e) => e.type === 'task.intervened');
    expect(intervened).toBeDefined();
    expect((intervened!.payload as { newGoal: string }).newGoal).toBe('also add a changelog');
    expect(result.context.slots.goal).toBe('also add a changelog');
  });
});

describe('CameliaRuntime — resume', () => {
  it('continues a paused task from its persisted plan without redoing finished steps', async () => {
    let runtimeRef: CameliaRuntime | undefined;
    const { runtime, workspace } = await harness(
      { create: { 'a.ts': 'x' }, commands: ['node --version'] },
      { onCall: (callIndex) => { if (callIndex === 2) runtimeRef?.pause('user asked'); } },
    );
    runtimeRef = runtime;

    const paused = await runtime.run('create a.ts');
    expect(paused.outcome.status).toBe('paused');
    expect(paused.outcome.stepsCompleted).toBe(1);

    // A resume re-enters the same task; the persisted plan and per-step statuses
    // decide where to continue, so the finished step is counted, not redone.
    const resumed = await runtime.run('', { resumeTaskId: paused.task.id });

    expect(resumed.outcome.status).toBe('done');
    expect(resumed.task.id).toBe(paused.task.id);
    expect(resumed.outcome.stepsCompleted).toBe(2);
    expect(resumed.outcome.stepsTotal).toBe(2);
    expect(fs.readFileSync(path.join(workspace, 'a.ts'), 'utf8')).toBe('x');
    const types = resumed.events.map((e) => e.type);
    expect(types).toContain('task.resumed');
    // The resume re-entered the task; it did not create (receive) a new one.
    expect(types.filter((t) => t === 'task.received')).toHaveLength(1);
  });

  it('rejects a resume for a task that does not exist', async () => {
    const { runtime } = await harness({ create: { 'a.ts': 'x' } });
    await expect(runtime.run('', { resumeTaskId: 'missing-task' })).rejects.toThrow(/not found/i);
  });
});

describe('CameliaRuntime — the approval boundary', () => {
  it('denies a privileged command when no approver is available', async () => {
    // autoApprove:false and a non-TTY stdin selects the deny-all responder.
    const { runtime } = await harness({ commands: ['node --version'] }, { autoApprove: false });
    const result = await runtime.run('check the node version');

    expect(result.events.some((e) => e.type === 'tool.denied')).toBe(true);
    const verdicts = result.outcome.verdicts;
    expect(verdicts.every((v) => v.status !== 'pass')).toBe(true);
    // Nothing could be objectively verified, and the outcome says so.
    expect(result.outcome.unverifiedSteps).toBeGreaterThan(0);
  });

  it('routes the verification command through the same gate as execution', async () => {
    const { runtime } = await harness({ commands: ['node --version'] }, { autoApprove: false });
    const result = await runtime.run('check the node version');
    const reason = result.outcome.verdicts.map((v) => v.reason).join(' ');
    expect(reason).toContain('not approved');
  });

  it('proceeds when the operator approves', async () => {
    const { runtime } = await harness({ commands: ['node --version'] }, { autoApprove: true });
    const result = await runtime.run('check the node version');
    expect(result.outcome.status).toBe('done');
    expect(result.outcome.unverifiedSteps).toBe(0);
  });
});

describe('CameliaRuntime — the three-path fallback chain', () => {
  it('advances past a failing provider and finishes the task on the next one', async () => {
    const workspace = tempDir('camelia-ws-');
    vi.stubEnv('CAMELIA_HOME', tempDir('camelia-home-'));

    const spec: ScriptedTaskSpec = { create: { 'a.ts': 'x' } };
    const failing: ProviderHandle = {
      id: 'primary',
      label: 'Primary (down)',
      model: 'primary-model',
      models: ['primary-model'],
      port: new MockProvider({
        id: 'primary',
        models: ['primary-model'],
        script: [{ error: { message: '429 rate limited', retryable: true } }],
      }),
    };
    const backup = scriptedHandle(spec);
    backup.id = 'backup';
    backup.label = 'Backup';

    const runtime = await CameliaRuntime.create({
      workspace,
      providerHandles: [failing, backup],
      databaseFile: ':memory:',
      autoApprove: true,
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(runtime);

    const result = await runtime.run('create a.ts');
    expect(result.outcome.status).toBe('done');
    expect(result.provider.id).toBe('backup');
    expect(result.provider.depth).toBe(1);
    expect(result.events.some((e) => e.type === 'provider.fallback')).toBe(true);
    expect(fs.readFileSync(path.join(workspace, 'a.ts'), 'utf8')).toBe('x');
  });
});

describe('CameliaRuntime — workspace containment', () => {
  it('refuses to let a tool escape the workspace', async () => {
    // The planner is scripted to write outside the workspace; the tool must refuse.
    const { runtime, workspace } = await harness({ create: { '../escaped.ts': 'nope' } });
    const result = await runtime.run('escape the workspace');

    expect(result.outcome.status).not.toBe('done');
    expect(fs.existsSync(path.join(path.dirname(workspace), 'escaped.ts'))).toBe(false);
  });
});