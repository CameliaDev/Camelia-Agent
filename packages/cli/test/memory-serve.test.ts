/**
 * Memory panel over `camelia serve` — visible · usable · tunable (Iteration 22).
 *
 * These drive a *real* runtime (real SQLite, real bus, real harness loop) over a real
 * HTTP socket. The memory panel's data source is asserted here, not in the UI: every
 * panel number comes from `listMemories / getMemory / listForgetLog /
 * listReactivationDue / getMemoryHealth` answered by `EngineServer → MemoryService →
 * SqliteSessionStore`. Interventions (`markMemoryIncorrect` / `forgetMemory` /
 * `promoteMemory`) mutate the real store and emit the same bus events as task-driven
 * ones. No API key, no network.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  CameliaRuntime,
  MockProvider,
  mockDemoSpec,
  scriptedTaskScript,
  type ProviderHandle,
  type ScriptedTaskSpec,
} from '@camelia/agent';
import { ENGINE_ROUTES, SSE_FRAME, type CommandAck, type MemoryView } from '@camelia/agent/view';
import type { Command, MemoryItem } from '@camelia/core';

import { ApprovalBroker } from '../src/server/ApprovalBroker.js';
import { EngineServer } from '../src/server/EngineServer.js';

const roots: string[] = [];
const originalHome = process.env.CAMELIA_HOME;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

beforeAll(() => {
  process.env.CAMELIA_HOME = tempDir('camelia-mem-serve-home-');
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.CAMELIA_HOME;
  else process.env.CAMELIA_HOME = originalHome;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

interface Frame {
  event: string;
  data: string;
}

/** Incremental SSE frame reader over a `fetch` body stream. */
class SseReader {
  readonly frames: Frame[] = [];
  private buffer = '';
  private readonly decoder = new TextDecoder();

  private constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {
    void this.pump();
  }

  static async open(url: string): Promise<SseReader> {
    const response = await fetch(url);
    if (!response.body) throw new Error('no response body');
    return new SseReader(response.body.getReader());
  }

  private async pump(): Promise<void> {
    for (;;) {
      const { value, done } = await this.reader.read();
      if (done) return;
      this.buffer += this.decoder.decode(value, { stream: true });
      let index = this.buffer.indexOf('\n\n');
      while (index >= 0) {
        const raw = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        const lines = raw.split('\n');
        let event = 'message';
        const data: string[] = [];
        for (const line of lines) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length > 0) this.frames.push({ event, data: data.join('\n') });
        index = this.buffer.indexOf('\n\n');
      }
    }
  }

  domains(): { type: string; payload: unknown }[] {
    return this.frames
      .filter((f) => f.event === SSE_FRAME.domain)
      .map((f) => JSON.parse(f.data) as { type: string; payload: unknown });
  }

  async waitFor(predicate: (frames: Frame[]) => boolean, timeoutMs = 15_000): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (predicate(this.frames)) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out; frames = ${JSON.stringify(this.frames.map((f) => `${f.event}:${f.data.slice(0, 60)}`))}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  cancel(): void {
    void this.reader.cancel().catch(() => undefined);
  }
}

/**
 * Post a command envelope. `payload` and `type` are deliberately loose: several
 * cases below exercise *rejected* commands (bad layer, unknown type, missing
 * memoryId) that do not fit the typed `Command` union.
 */
async function postCommand(
  baseUrl: string,
  command: { type: string; payload: unknown; commandId: string; traceId: string; ts: number },
): Promise<{ status: number; body: CommandAck }> {
  const response = await fetch(`${baseUrl}${ENGINE_ROUTES.command}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  return { status: response.status, body: (await response.json()) as CommandAck };
}

const CMD = { commandId: 'cmd_mem_test', traceId: 'trc_mem_test', ts: 1 };

async function makeServer(options: { spec: ScriptedTaskSpec; databaseFile?: string }) {
  const workspace = tempDir('camelia-mem-ws-');
  const script = scriptedTaskScript(options.spec);
  const handle: ProviderHandle = {
    id: 'mock',
    label: 'Scripted mock',
    model: 'scripted',
    models: ['scripted'],
    port: new MockProvider({ id: 'mock', models: ['scripted'], script }),
  };
  const broker = new ApprovalBroker({ timeoutMs: 5_000 });
  const runtime = await CameliaRuntime.create({
    workspace,
    providerHandles: [handle],
    approvalResponder: broker.responder(),
    databaseFile: options.databaseFile ?? ':memory:',
    logLevel: 'error',
    logTo: () => undefined,
  });
  const server = new EngineServer({ runtime, broker, port: 0, offlineClarify: true });
  const address = await server.start();
  return { server, runtime, broker, address, workspace };
}

/** Write a memory through the real engine's persistence layer (as a reflection would). */
function writeMemory(runtime: CameliaRuntime, overrides: Partial<MemoryItem> & { content: string }): Promise<void> {
  const now = Date.now();
  return runtime.store.writeMemory({
    id: overrides.id ?? `mem_${now.toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`,
    scope: overrides.scope ?? 'global',
    ...(overrides.sessionId ? { sessionId: overrides.sessionId } : {}),
    kind: overrides.kind ?? 'fact',
    content: overrides.content,
    keywords: overrides.keywords ?? '',
    importance: overrides.importance ?? 0.5,
    correctness: overrides.correctness ?? 0.5,
    ...(overrides.layer ? { layer: overrides.layer } : {}),
    ...(overrides.nextReviewAt ? { nextReviewAt: overrides.nextReviewAt } : {}),
    ...(overrides.evidence ? { evidence: overrides.evidence } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

const servers: EngineServer[] = [];
const runtimes: CameliaRuntime[] = [];
const readers: SseReader[] = [];

afterEach(async () => {
  for (const reader of readers.splice(0)) reader.cancel();
  for (const server of servers.splice(0)) await server.stop();
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

describe('memory panel queries over serve (Iteration 22)', () => {
  it('list_memories returns engine data, filterable by layer; bad layers are rejected', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-list') });
    servers.push(server);
    runtimes.push(runtime);
    await writeMemory(runtime, { id: 'mem_long_1', content: 'the build command is pnpm build', keywords: 'pnpm build', layer: 'long', importance: 0.8 });
    await writeMemory(runtime, { id: 'mem_short_1', scope: 'session', sessionId: runtime.session.id, content: 'the fixture port was 5173', keywords: 'fixture port', layer: 'short' });

    const all = await postCommand(address.url, { type: 'list_memories', payload: {}, ...CMD });
    expect(all.status).toBe(200);
    expect(all.body.ok).toBe(true);
    const items = all.body.data as MemoryView[];
    expect(items.map((m) => m.id).sort()).toEqual(['mem_long_1', 'mem_short_1']);
    expect(items.every((m) => typeof m.strength === 'number' && typeof m.recency === 'number')).toBe(true);

    const longs = await postCommand(address.url, { type: 'list_memories', payload: { layer: 'long' }, ...CMD });
    const longItems = longs.body.data as MemoryView[];
    expect(longItems.map((m) => m.id)).toEqual(['mem_long_1']);
    expect(longItems[0]!.layer).toBe('long');

    const bad = await postCommand(address.url, { type: 'list_memories', payload: { layer: 'epoch' }, ...CMD });
    expect(bad.status).toBe(409);
    expect(bad.body.error).toContain('无效的记忆层');
  });

  it('get_memory returns one memory, evidence included; missing memoryId is rejected', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-get') });
    servers.push(server);
    runtimes.push(runtime);
    await writeMemory(runtime, {
      id: 'mem_ev_1',
      content: 'scaffold recipe', keywords: 'recipe', kind: 'procedural', layer: 'procedural',
      evidence: { taskId: 'tsk_v1', verdict: 'pass', at: Date.now() },
    });

    const got = await postCommand(address.url, { type: 'get_memory', payload: { memoryId: 'mem_ev_1' }, ...CMD });
    expect(got.body.ok).toBe(true);
    const memory = got.body.data as MemoryView;
    expect(memory.id).toBe('mem_ev_1');
    expect(memory.evidence?.taskId).toBe('tsk_v1');
    expect(memory.evidence?.verdict).toBe('pass');

    const missing = await postCommand(address.url, { type: 'get_memory', payload: {}, ...CMD });
    expect(missing.status).toBe(409);
    expect(missing.body.error).toContain('缺少 memoryId 参数');

    const unknown = await postCommand(address.url, { type: 'get_memory', payload: { memoryId: 'mem_nope' }, ...CMD });
    expect(unknown.body.ok).toBe(true);
    expect(unknown.body.data).toBeNull();
  });

  it('list_reactivation_due returns the spaced-repetition queue from the engine', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-due') });
    servers.push(server);
    runtimes.push(runtime);
    const now = Date.now();
    await writeMemory(runtime, {
      id: 'mem_due_1', content: 'staging key in the vault', keywords: 'vault', importance: 0.9, nextReviewAt: now - 1,
    });
    // Not due: its spaced-repetition slot is still in the future.
    await writeMemory(runtime, { id: 'mem_due_2', content: 'irrelevant trivia', keywords: 'trivia', importance: 0.1, nextReviewAt: now + 24 * 60 * 60 * 1000 });

    const due = await postCommand(address.url, { type: 'list_reactivation_due', payload: { limit: 3 }, ...CMD });
    const items = due.body.data as MemoryView[];
    expect(items.map((m) => m.id)).toContain('mem_due_1');
    expect(items.map((m) => m.id)).not.toContain('mem_due_2');
  });

  it('get_memory_health reports layer counts and the cross-session recall-noise rate', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-health') });
    servers.push(server);
    runtimes.push(runtime);
    await writeMemory(runtime, { id: 'mem_h1', content: 'a long fact', keywords: 'a', layer: 'long' });
    await writeMemory(runtime, { id: 'mem_h2', content: 'a short fact', keywords: 'b', scope: 'session', sessionId: runtime.session.id, layer: 'short' });

    const health = await postCommand(address.url, { type: 'get_memory_health', payload: {}, ...CMD });
    expect(health.body.ok).toBe(true);
    const data = health.body.data as { totalMemories: number; byLayer: Record<string, number>; recallNoise: { noiseRate: number } };
    expect(data.totalMemories).toBe(2);
    expect(data.byLayer.long).toBe(1);
    expect(data.byLayer.short).toBe(1);
    expect(data.recallNoise.noiseRate).toBe(0); // clean log — nothing downgraded yet
  });
});

describe('memory interventions over serve (Iteration 22)', () => {
  it('mark_memory_incorrect downgrades, exits reactivation and emits memory.downgraded on the stream', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-incorrect') });
    servers.push(server);
    runtimes.push(runtime);
    const now = Date.now();
    await writeMemory(runtime, {
      id: 'mem_bad_1', content: 'scaffold recipe that failed verification', keywords: 'scaffold',
      kind: 'procedural', layer: 'procedural', importance: 0.8, nextReviewAt: now - 1,
    });

    const reader = await SseReader.open(`${address.url}${ENGINE_ROUTES.events}`);
    readers.push(reader);
    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.bootstrap));

    const before = await postCommand(address.url, { type: 'list_reactivation_due', payload: { limit: 3 }, ...CMD });
    expect((before.body.data as MemoryView[]).map((m) => m.id)).toContain('mem_bad_1');

    const ack = await postCommand(address.url, { type: 'mark_memory_incorrect', payload: { memoryId: 'mem_bad_1', reason: 'user-correction' }, ...CMD });
    expect(ack.status).toBe(200);
    expect(ack.body.ok).toBe(true);

    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.domain && JSON.parse(f.data).type === 'memory.downgraded'));
    const downgraded = reader.domains().find((e) => e.type === 'memory.downgraded')!.payload as { memoryId: string; reason: string };
    expect(downgraded.memoryId).toBe('mem_bad_1');
    expect(downgraded.reason).toBe('user-correction');

    const after = await postCommand(address.url, { type: 'get_memory', payload: { memoryId: 'mem_bad_1' }, ...CMD });
    expect((after.body.data as MemoryView).correctness).toBe(0);

    const due = await postCommand(address.url, { type: 'list_reactivation_due', payload: { limit: 3 }, ...CMD });
    expect((due.body.data as MemoryView[]).map((m) => m.id)).not.toContain('mem_bad_1');
  });

  it('forget_memory removes the item and leaves an audit-trail entry in the forget log', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-forget') });
    servers.push(server);
    runtimes.push(runtime);
    await writeMemory(runtime, { id: 'mem_gone_1', content: 'transient token format details', keywords: 'token format' });

    const ack = await postCommand(address.url, { type: 'forget_memory', payload: { memoryId: 'mem_gone_1', reason: 'manual-test' }, ...CMD });
    expect(ack.body.ok).toBe(true);

    const gone = await postCommand(address.url, { type: 'get_memory', payload: { memoryId: 'mem_gone_1' }, ...CMD });
    expect(gone.body.data).toBeNull();

    const log = await postCommand(address.url, { type: 'list_forget_log', payload: {}, ...CMD });
    const entries = log.body.data as Array<{ memoryId: string; reason: string; contentSnippet: string }>;
    expect(entries[0]?.memoryId).toBe('mem_gone_1');
    expect(entries[0]?.reason).toBe('manual-test');
    expect(entries[0]?.contentSnippet).toContain('transient token');
  });

  it('promote_memory upgrades one short memory to long-term/global and emits memory.promoted', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-promote') });
    servers.push(server);
    runtimes.push(runtime);
    await writeMemory(runtime, { id: 'mem_promote_1', content: 'user wants this kept', keywords: 'keep', scope: 'session', sessionId: runtime.session.id, layer: 'short' });

    const reader = await SseReader.open(`${address.url}${ENGINE_ROUTES.events}`);
    readers.push(reader);
    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.bootstrap));

    const ack = await postCommand(address.url, { type: 'promote_memory', payload: { memoryId: 'mem_promote_1' }, ...CMD });
    expect(ack.body.ok).toBe(true);

    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.domain && JSON.parse(f.data).type === 'memory.promoted'));

    const got = await postCommand(address.url, { type: 'get_memory', payload: { memoryId: 'mem_promote_1' }, ...CMD });
    const memory = got.body.data as MemoryView;
    expect(memory.layer).toBe('long');
    expect(memory.scope).toBe('global');
  });
});

describe('real-engine e2e — write, restart serve, panel sees the same data (Iteration 22)', () => {
  it('persists across a serve restart and answers identically', async () => {
    const root = tempDir('camelia-mem-e2e-');
    const databaseFile = path.join(root, 'camelia.db');

    // First engine writes the memories.
    const first = await makeServer({ spec: mockDemoSpec('e2e-write'), databaseFile });
    servers.push(first.server);
    runtimes.push(first.runtime);
    await writeMemory(first.runtime, { id: 'mem_e2e_1', content: 'the staging key lives in the vault', keywords: 'vault staging', layer: 'long', importance: 0.9 });
    await writeMemory(first.runtime, { id: 'mem_e2e_2', content: 'fixture port 5173', keywords: 'fixture port', scope: 'session', sessionId: first.runtime.session.id, layer: 'short' });

    const before = await postCommand(first.address.url, { type: 'list_memories', payload: {}, ...CMD });
    const beforeIds = (before.body.data as MemoryView[]).map((m) => m.id).sort();

    // Tear the engine down completely — this is a cold restart, not a reconnect.
    await first.server.stop();
    await first.runtime.close();
    servers.splice(servers.indexOf(first.server), 1);
    runtimes.splice(runtimes.indexOf(first.runtime), 1);

    // Second engine, same database file.
    const second = await makeServer({ spec: mockDemoSpec('e2e-read'), databaseFile });
    servers.push(second.server);
    runtimes.push(second.runtime);

    const after = await postCommand(second.address.url, { type: 'list_memories', payload: {}, ...CMD });
    expect(after.body.ok).toBe(true);
    const items = after.body.data as MemoryView[];
    expect(items.map((m) => m.id).sort()).toEqual(beforeIds);
    expect(items.find((m) => m.id === 'mem_e2e_1')?.content).toBe('the staging key lives in the vault');
    expect(items.find((m) => m.id === 'mem_e2e_1')?.layer).toBe('long');
    expect(items.find((m) => m.id === 'mem_e2e_2')?.layer).toBe('short');
  }, 30_000);
});

describe('memory command guardrails (Iteration 22)', () => {
  it('rejects an unknown command type honestly', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-unknown') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'list_memoriez', payload: {}, ...CMD });
    expect(ack.status).toBe(409);
    expect(ack.body.ok).toBe(false);
    expect(ack.body.error).toContain('不支持的命令');
  });

  it('rejects an intervention on a missing memory instead of faking success', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-missing') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'mark_memory_incorrect', payload: { memoryId: 'mem_nope', reason: 'x' }, ...CMD });
    expect(ack.body.ok).toBe(false);
    expect(ack.body.error).toContain('memory not found');
  });
});

describe('session and workspace commands', () => {
  it('set_workspace accepts a directory and refuses a file', async () => {
    const { server, runtime, address, workspace } = await makeServer({ spec: mockDemoSpec('ws-set') });
    servers.push(server);
    runtimes.push(runtime);
    const next = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-ws-next-'));
    const ok = await postCommand(address.url, { type: 'set_workspace', payload: { path: next }, ...CMD });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect((ok.body.data as { workspace: string }).workspace).toBe(path.resolve(next));
    const file = path.join(workspace, 'not-a-dir.txt');
    fs.writeFileSync(file, 'x');
    const bad = await postCommand(address.url, { type: 'set_workspace', payload: { path: file }, ...CMD });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error).toContain('这不是文件夹');
  });

  it('list_memories curated hides artifact rows', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('mem-curated') });
    servers.push(server);
    runtimes.push(runtime);
    await writeMemory(runtime, { id: 'mem_fact_keep', content: 'prefer pnpm', kind: 'preference', layer: 'long' });
    await writeMemory(runtime, {
      id: 'mem_art',
      content: 'Task "问候用户" produced 1 artifact(s) across 1 step(s).',
      kind: 'artifact',
      layer: 'short',
      scope: 'session',
      sessionId: runtime.session.id,
    });
    const curated = await postCommand(address.url, { type: 'list_memories', payload: { curated: true }, ...CMD });
    const items = curated.body.data as MemoryView[];
    expect(items.map((item) => item.id)).toEqual(['mem_fact_keep']);
    const all = await postCommand(address.url, { type: 'list_memories', payload: {}, ...CMD });
    expect((all.body.data as MemoryView[]).map((item) => item.id).sort()).toEqual(['mem_art', 'mem_fact_keep']);
  });

  it('renames and deletes a session without reusing a titled blank', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('ses-crud') });
    servers.push(server);
    runtimes.push(runtime);
    const titled = await runtime.store.createSession({
      title: 'hello',
      workspace: runtime.workspace,
      provider: 'mock',
      model: 'scripted',
      kind: 'work',
    });
    const renamed = await postCommand(address.url, {
      type: 'rename_session',
      payload: { sessionId: titled.id, title: 'notes' },
      ...CMD,
    });
    expect(renamed.body.ok).toBe(true);
    expect((await runtime.store.getSession(titled.id))?.title).toBe('notes');
    const removed = await postCommand(address.url, {
      type: 'delete_session',
      payload: { sessionId: titled.id },
      ...CMD,
    });
    expect(removed.body.ok).toBe(true);
    expect(await runtime.store.getSession(titled.id)).toBeUndefined();
    const first = await runtime.newSession('work');
    const second = await runtime.newSession('work');
    expect(second.sessionId).toBe(first.sessionId);
    expect(first.sessionId).not.toBe(titled.id);
  });
});
