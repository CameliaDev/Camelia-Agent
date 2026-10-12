/**
 * `list_recall_history` over serve (Iteration 26 — Stage 2).
 *
 * The recall timeline is the memory panel's *visible* recall history: persisted
 * `memory.recalled` events answered by `EngineServer → MemoryService` (real
 * runtime, real SQLite — no fixture). These tests pin the protocol (data via
 * CommandAck.data), the 409 guardrails for malformed queries and the cold-restart
 * contract: write recalls, tear the engine down, reopen the same database file,
 * and the timeline answers identically.
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
import { ENGINE_ROUTES, SSE_FRAME, type CommandAck, type MemoryRecallView } from '@camelia/agent/view';
import type { MemoryItem } from '@camelia/core';

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
  process.env.CAMELIA_HOME = tempDir('camelia-recall-serve-home-');
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

/** Incremental SSE frame reader over a `fetch` body stream (Iteration 22 pattern). */
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

  cancel(): void {
    void this.reader.cancel().catch(() => undefined);
  }
}

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

const CMD = { commandId: 'cmd_recall_test', traceId: 'trc_recall_test', ts: 1 };

async function makeServer(options: { spec: ScriptedTaskSpec; databaseFile?: string }) {
  const workspace = tempDir('camelia-recall-ws-');
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

/** Write a memory through the real engine's persistence layer. */
function writeMemory(runtime: CameliaRuntime, overrides: Partial<MemoryItem> & { id: string; content: string }): Promise<void> {
  const now = Date.now();
  return runtime.store.writeMemory({
    id: overrides.id,
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

/** Emit a persisted `memory.recalled` (and optionally a later downgrade) through the real bus. */
async function emitRecall(
  runtime: CameliaRuntime,
  options: { memoryId: string; layer: string; matchedBy: string; noise: number; at: number; downgradeAfterMs?: number },
): Promise<void> {
  const sessionId = runtime.session.id;
  runtime.bus.emit(
    'memory.recalled',
    {
      count: 1,
      ids: [options.memoryId],
      noise: options.noise,
      provenance: [{ memoryId: options.memoryId, layer: options.layer, matchedBy: options.matchedBy }],
    },
    { traceId: 'trc_recall', sessionId, taskId: 'tsk_recall', ts: options.at },
  );
  if (options.downgradeAfterMs !== undefined) {
    runtime.bus.emit(
      'memory.downgraded',
      { memoryId: options.memoryId, reason: 'user-correction', correctness: 0 },
      { traceId: 'trc_downgrade', sessionId, taskId: 'tsk_recall', ts: options.downgradeAfterMs },
    );
  }
  await runtime.flush();
}

const servers: EngineServer[] = [];
const runtimes: CameliaRuntime[] = [];
const readers: SseReader[] = [];

afterEach(async () => {
  for (const reader of readers.splice(0)) reader.cancel();
  for (const server of servers.splice(0)) await server.stop();
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

describe('list_recall_history over serve (Iteration 26)', () => {
  it('returns the persisted recall timeline via CommandAck.data, with content from the store', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('recall-list') });
    servers.push(server);
    runtimes.push(runtime);
    await writeMemory(runtime, { id: 'mem_recall_1', content: 'the build command is pnpm build', keywords: 'pnpm build', layer: 'long', importance: 0.8 });
    await emitRecall(runtime, { memoryId: 'mem_recall_1', layer: 'long', matchedBy: 'build', noise: 0.25, at: 1_000 });
    await emitRecall(runtime, { memoryId: 'mem_recall_1', layer: 'long', matchedBy: 'pnpm', noise: 0, at: 2_000, downgradeAfterMs: 3_000 });

    const ack = await postCommand(address.url, {
      type: 'list_recall_history',
      payload: { sessionId: runtime.session.id },
      ...CMD,
    });
    expect(ack.status).toBe(200);
    expect(ack.body.ok).toBe(true);
    const hits = ack.body.data as MemoryRecallView[];
    expect(hits).toHaveLength(2);
    expect(hits[0]!.at).toBe(1_000);
    expect(hits[0]!.memoryId).toBe('mem_recall_1');
    expect(hits[0]!.layer).toBe('long');
    expect(hits[0]!.contentSnippet).toContain('pnpm build');
    expect(hits[0]!.matchedBy).toBe('build');
    expect(hits[0]!.noise).toBe(0.25);
    // Both hits of this memory are annotated: the memory was later downgraded in
    // this window — the same 口径 as the aggregate's downgradedHits (it counts
    // every recalled hit of a downgraded memory, including the earlier ones).
    expect(hits[0]!.downgraded).toBe(true);
    expect(hits[1]!.downgraded).toBe(true);
    expect(hits[1]!.at).toBe(2_000);
  });

  it('honours memoryId / since / limit filters at the engine boundary', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('recall-filters') });
    servers.push(server);
    runtimes.push(runtime);
    await writeMemory(runtime, { id: 'mem_a', content: 'a fact', keywords: 'a', layer: 'long' });
    await writeMemory(runtime, { id: 'mem_b', content: 'b fact', keywords: 'b', layer: 'short' });
    await emitRecall(runtime, { memoryId: 'mem_a', layer: 'long', matchedBy: 'a', noise: 0, at: 100 });
    await emitRecall(runtime, { memoryId: 'mem_b', layer: 'short', matchedBy: 'b', noise: 0, at: 200 });

    const onlyB = await postCommand(address.url, { type: 'list_recall_history', payload: { sessionId: runtime.session.id, memoryId: 'mem_b' }, ...CMD });
    expect((onlyB.body.data as MemoryRecallView[]).map((h) => h.memoryId)).toEqual(['mem_b']);
    // mem_b was never downgraded — the annotation stays false (反例).
    expect((onlyB.body.data as MemoryRecallView[])[0]!.downgraded).toBe(false);

    const since = await postCommand(address.url, { type: 'list_recall_history', payload: { sessionId: runtime.session.id, since: 150 }, ...CMD });
    expect((since.body.data as MemoryRecallView[]).map((h) => h.memoryId)).toEqual(['mem_b']);

    const limited = await postCommand(address.url, { type: 'list_recall_history', payload: { sessionId: runtime.session.id, limit: 1 }, ...CMD });
    expect((limited.body.data as MemoryRecallView[]).map((h) => h.memoryId)).toEqual(['mem_b']); // most recent
  });
});

describe('list_recall_history guardrails (Iteration 26)', () => {
  it('rejects an unknown command type with 409', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('recall-unknown') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'list_recall_histor', payload: {}, ...CMD });
    expect(ack.status).toBe(409);
    expect(ack.body.ok).toBe(false);
    expect(ack.body.error).toContain('unsupported command');
  });

  it('rejects a non-string memoryId with 409', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('recall-bad-memid') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'list_recall_history', payload: { memoryId: 42 }, ...CMD });
    expect(ack.status).toBe(409);
    expect(ack.body.error).toContain('memoryId must be a string');
  });

  it('rejects a non-finite since with 409', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('recall-bad-since') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'list_recall_history', payload: { since: 'soon' }, ...CMD });
    expect(ack.status).toBe(409);
    expect(ack.body.error).toContain('since must be a finite timestamp');
  });

  it('rejects an out-of-range limit with 409', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('recall-bad-limit') });
    servers.push(server);
    runtimes.push(runtime);
    const zero = await postCommand(address.url, { type: 'list_recall_history', payload: { limit: 0 }, ...CMD });
    expect(zero.status).toBe(409);
    expect(zero.body.error).toContain('limit must be an integer');
    const fraction = await postCommand(address.url, { type: 'list_recall_history', payload: { limit: 2.5 }, ...CMD });
    expect(fraction.status).toBe(409);
  });
});

describe('real-engine e2e — recall timeline survives a cold restart (Iteration 26)', () => {
  it('answers identically after serve is torn down and reopened on the same database file', async () => {
    const root = tempDir('camelia-recall-e2e-');
    const databaseFile = path.join(root, 'camelia.db');

    const first = await makeServer({ spec: mockDemoSpec('recall-e2e-write'), databaseFile });
    servers.push(first.server);
    runtimes.push(first.runtime);
    await writeMemory(first.runtime, { id: 'mem_e2e_a', content: 'staging key lives in the vault', keywords: 'vault', layer: 'long', importance: 0.9 });
    await writeMemory(first.runtime, { id: 'mem_e2e_b', content: 'fixture port is 5173', keywords: 'fixture port', scope: 'session', sessionId: first.runtime.session.id, layer: 'short' });
    await emitRecall(first.runtime, { memoryId: 'mem_e2e_a', layer: 'long', matchedBy: 'vault', noise: 0.33, at: 1_000 });
    await emitRecall(first.runtime, { memoryId: 'mem_e2e_b', layer: 'short', matchedBy: 'port', noise: 0.5, at: 2_000, downgradeAfterMs: 3_000 });

    const before = await postCommand(first.address.url, { type: 'list_recall_history', payload: {}, ...CMD });
    expect(before.body.ok).toBe(true);
    const beforeHits = before.body.data as MemoryRecallView[];

    // Full cold restart: stop the server and close the runtime.
    await first.server.stop();
    await first.runtime.close();
    servers.splice(servers.indexOf(first.server), 1);
    runtimes.splice(runtimes.indexOf(first.runtime), 1);

    const second = await makeServer({ spec: mockDemoSpec('recall-e2e-read'), databaseFile });
    servers.push(second.server);
    runtimes.push(second.runtime);

    // The panel reads the timeline across sessions (same surface as list_memories),
    // so a fresh session after restart must still see the persisted recalls.
    const after = await postCommand(second.address.url, { type: 'list_recall_history', payload: {}, ...CMD });
    expect(after.body.ok).toBe(true);
    const afterHits = after.body.data as MemoryRecallView[];
    expect(afterHits).toEqual(beforeHits); // same hits, same order, same annotations
    expect(afterHits[1]!.downgraded).toBe(true);
    expect(afterHits[0]!.contentSnippet).toContain('vault');
  }, 30_000);
});
