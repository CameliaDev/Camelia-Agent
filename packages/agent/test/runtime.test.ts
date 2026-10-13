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
import { autoApprover } from '../src/runtime/ApprovalResponders.js';
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
      { onCall: (callIndex) => { if (callIndex === 2) runtimeRef?.pause(runtimeRef!.activeTaskId!, 'user asked'); } },
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
      { onCall: (callIndex) => { if (callIndex === 2) runtimeRef?.cancel(runtimeRef!.activeTaskId!, 'user cancelled'); } },
    );
    runtimeRef = runtime;

    const result = await runtime.run('create a.ts');
    expect(result.outcome.status).toBe('cancelled');
  });

  it('refuses a pause aimed at a task other than the running one', async () => {
    // The rail lets the user switch sessions mid-run, so the pause button on screen can
    // name a task the engine is not executing. Stopping the invisible one anyway would be
    // a silent wrong-target kill, so the mismatch is refused.
    const seen: boolean[] = [];
    let runtimeRef: CameliaRuntime | undefined;
    const { runtime } = await harness(
      { create: { 'a.ts': 'x' }, commands: ['node --version'] },
      {
        onCall: (callIndex) => {
          if (callIndex !== 2) return;
          seen.push(runtimeRef!.pause('tsk_some_other_task', 'user asked'));
        },
      },
    );
    runtimeRef = runtime;

    const result = await runtime.run('create a.ts');
    expect(seen).toEqual([false]);
    // The run continued to completion rather than being stopped by a foreign pause.
    expect(result.outcome.status).toBe('done');
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
      { onCall: (callIndex) => { if (callIndex === 2) runtimeRef?.pause(runtimeRef!.activeTaskId!, 'user asked'); } },
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

describe('CameliaRuntime — plan approval precedence', () => {
  /**
   * `~/.camelia/config.json` is the durable policy and must be reachable.
   *
   * This is a regression guard: `camelia serve` used to pass `planApproval` as a top-level
   * option on *every* launch — `auto` only when a flag asked for it, `always` otherwise.
   * Because that option is the first link in `create`'s `??` chain, it shadowed the file
   * unconditionally. The desktop shell spawns `serve` with no flags, so a persisted `auto`
   * could never take effect and every conversation stopped at the plan gate.
   */
  async function createWithConfig(planApproval: unknown) {
    const home = tempDir('camelia-home-');
    vi.stubEnv('CAMELIA_HOME', home);
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ planApproval }));
    const runtime = await CameliaRuntime.create({
      workspace: tempDir('camelia-ws-'),
      providerHandles: [scriptedHandle({ create: { 'a.ts': 'x' } })],
      databaseFile: ':memory:',
      // Approve *tools* explicitly rather than via `autoApprove`: that flag also forces the
      // plan policy to `auto` further down `create`, which would mask what is under test.
      approvalResponder: autoApprover(),
      logLevel: 'error',
      logTo: () => undefined,
      // Deliberately no `planApproval`: this is exactly what `serve` passes now.
    });
    runtimes.push(runtime);
    return runtime;
  }

  it('honours planApproval from config.json when no flag overrides it', async () => {
    expect((await createWithConfig('auto')).harnessConfig.planApproval).toBe('auto');
    // And the other direction, so the test cannot pass by ignoring the file entirely.
    expect((await createWithConfig('always')).harnessConfig.planApproval).toBe('always');
  });

  it('lets a run proceed without a click when the file says auto', async () => {
    // The decisive one. `approvePlan` awaits `gate.ask` under `always`, and nothing in this
    // test answers — so if the policy were not read from the file, this call would never
    // settle. Reaching `done` proves the loop consulted the file rather than the option
    // `serve` used to hardcode on every launch.
    const runtime = await createWithConfig('auto');
    const result = await runtime.run('create a.ts with a constant');

    expect(result.outcome.status).toBe('done');
  });

  it('falls back to `always` when the file has no opinion', async () => {
    // Headless default: nobody is watching a CLI to click approve.
    expect((await createWithConfig(undefined)).harnessConfig.planApproval).toBe('always');
    // A junk value must not be read as consent.
    expect((await createWithConfig('sometimes')).harnessConfig.planApproval).toBe('always');
  });

  it('still lets an explicit option win over the file', async () => {
    // The `--yes` path, which is what `serve` passes when a flag does ask.
    const home = tempDir('camelia-home-');
    vi.stubEnv('CAMELIA_HOME', home);
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ planApproval: 'always' }));
    const runtime = await CameliaRuntime.create({
      workspace: tempDir('camelia-ws-'),
      providerHandles: [scriptedHandle({ create: { 'a.ts': 'x' } })],
      databaseFile: ':memory:',
      approvalResponder: autoApprover(),
      planApproval: 'auto',
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(runtime);
    expect(runtime.harnessConfig.planApproval).toBe('auto');
  });
});

describe('CameliaRuntime — boot hygiene', () => {
  /**
   * Both repairs address state a *previous* process left behind, so they need a database
   * that outlives one `create()` call. `:memory:` cannot show either bug.
   */
  async function boot(db: string, workspace: string, home: string): Promise<CameliaRuntime> {
    vi.stubEnv('CAMELIA_HOME', home);
    const runtime = await CameliaRuntime.create({
      workspace,
      providerHandles: [scriptedHandle({ create: { 'a.ts': 'x' } })],
      databaseFile: db,
      approvalResponder: autoApprover(),
      planApproval: 'auto',
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(runtime);
    return runtime;
  }

  it('reopens the workspace session instead of starting a new one on every boot', async () => {
    // Every launch used to create a session titled after the workspace. One real install
    // accumulated 26 of them: all empty, none distinguishable in the rail, and each one
    // another row the user has to scroll past.
    const home = tempDir('camelia-home-');
    const db = path.join(tempDir('camelia-boot-db-'), 'camelia.db');
    const workspace = tempDir('camelia-boot-ws-');

    const first = await boot(db, workspace, home);
    const sessionId = first.session.id;
    await first.run('create a.ts with a constant');
    await first.close();

    const second = await boot(db, workspace, home);
    expect(second.session.id).toBe(sessionId);
    expect(await second.store.listSessions()).toHaveLength(1);
  });

  it('repairs a task the previous process left mid-flight', async () => {
    // A gate is an in-memory promise. A restart leaves the status behind and nothing that
    // can settle it — the shell then shows 批准 for a plan that cannot be approved.
    const home = tempDir('camelia-home-');
    const db = path.join(tempDir('camelia-orphan-db-'), 'camelia.db');
    const workspace = tempDir('camelia-orphan-ws-');

    const first = await boot(db, workspace, home);
    const orphan = await first.store.createTask({
      sessionId: first.session.id,
      intentRaw: 'leave me at the gate',
      workspace,
    });
    await first.store.updateTask(orphan.id, { status: 'awaiting-approval', phase: 'awaiting-approval' });
    const settled = await first.store.createTask({
      sessionId: first.session.id,
      intentRaw: 'already finished',
      workspace,
    });
    await first.store.updateTask(settled.id, { status: 'done', phase: 'delivering' });
    await first.close();

    const second = await boot(db, workspace, home);

    const repaired = await second.store.getTask(orphan.id);
    expect(repaired?.status).toBe('paused');
    // The status it was stuck in is remembered so the resume path knows where it stopped.
    expect(repaired?.resumeTarget).toBe('awaiting-approval');
    expect(repaired?.phase).toBe('paused');

    // A terminal task is history, not debris — leave it exactly as it was.
    const untouched = await second.store.getTask(settled.id);
    expect(untouched?.status).toBe('done');
    expect(untouched?.resumeTarget).toBeUndefined();
  });

  it('repairs an orphan in a session this engine is not sitting in', async () => {
    // One install had seven orphans, one per session. Repairing only the reopened session
    // would leave every other row in the rail ready to show a 批准 button that cannot work.
    const home = tempDir('camelia-home-');
    const db = path.join(tempDir('camelia-far-db-'), 'camelia.db');
    const workspace = tempDir('camelia-far-ws-');

    const first = await boot(db, workspace, home);
    const homeSession = first.session.id;
    const elsewhere = await first.store.createSession({
      title: 'an older session',
      workspace,
      provider: 'mock',
      model: 'scripted',
    });
    const orphan = await first.store.createTask({
      sessionId: elsewhere.id,
      intentRaw: 'stranded in another session',
      workspace,
    });
    await first.store.updateTask(orphan.id, { status: 'executing', phase: 'executing' });
    // Touch the boot session last so *it* is the newest and gets reopened, leaving the
    // orphan in a session this engine will not be sitting in.
    await first.store.updateSession(homeSession, { title: 'the one we come back to' });
    await first.close();

    const second = await boot(db, workspace, home);
    expect(second.session.id).toBe(homeSession);

    const repaired = await second.store.getTask(orphan.id);
    expect(repaired?.status).toBe('paused');
    expect(repaired?.resumeTarget).toBe('executing');
  });

  it('leaves an explicitly paused task alone across a restart', async () => {
    // `paused` is a status the user can already act on, so re-repairing it every boot would
    // quietly overwrite the resumeTarget it was carrying.
    const home = tempDir('camelia-home-');
    const db = path.join(tempDir('camelia-paused-db-'), 'camelia.db');
    const workspace = tempDir('camelia-paused-ws-');

    const first = await boot(db, workspace, home);
    const paused = await first.store.createTask({
      sessionId: first.session.id,
      intentRaw: 'user paused me',
      workspace,
    });
    await first.store.updateTask(paused.id, {
      status: 'paused',
      phase: 'paused',
      resumeTarget: 'executing',
    });
    await first.close();

    const second = await boot(db, workspace, home);
    const after = await second.store.getTask(paused.id);
    expect(after?.status).toBe('paused');
    expect(after?.resumeTarget).toBe('executing');
  });
});


describe('CameliaRuntime — newSession blank reuse', () => {
  it('reuses an unused blank of the same kind instead of stacking rows', async () => {
    const { runtime } = await harness({
      create: { 'a.ts': 'export const a = 1;\n' },
    });
    const first = await runtime.newSession('work');
    const second = await runtime.newSession('work');
    expect(second.sessionId).toBe(first.sessionId);
    const sessions = await runtime.store.listSessions();
    const blanks = [];
    for (const s of sessions) {
      if ((s.kind ?? 'work') !== 'work') continue;
      const tasks = await runtime.store.listTasks(s.id);
      const events = await runtime.store.listEvents({ sessionId: s.id, limit: 1 });
      if (tasks.length === 0 && events.length === 0) blanks.push(s.id);
    }
    // At most one unused work blank (plus whatever the harness opened for the workspace).
    expect(blanks.filter((id) => id === first.sessionId)).toHaveLength(1);
    expect(new Set(blanks).size).toBe(blanks.length);
  });

  it('creates a distinct blank for math vs work', async () => {
    const { runtime } = await harness({
      create: { 'a.ts': 'export const a = 1;\n' },
    });
    const work = await runtime.newSession('work');
    const math = await runtime.newSession('math');
    expect(math.sessionId).not.toBe(work.sessionId);
  });
});
