/**
 * Engine server integration tests (whitepaper §6.1).
 *
 * These drive a *real* runtime — real SQLite, real event bus, real harness loop — over a
 * real HTTP socket, with the scripted provider standing in for a model. What is asserted
 * is the contract the webview depends on: bootstrap before events, domain events in
 * order, commands mapped onto runtime methods, and honest rejections for anything the
 * engine cannot do. No API key, no network.
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
import { ENGINE_ROUTES, SSE_FRAME, type EngineHealth, type CommandAck } from '@camelia/agent/view';
import type { Command } from '@camelia/core';

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
  process.env.CAMELIA_HOME = tempDir('camelia-serve-home-');
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
        const frame = parseFrame(raw);
        if (frame) this.frames.push(frame);
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

function parseFrame(raw: string): Frame | undefined {
  const lines = raw.split('\n');
  let event = 'message';
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  return { event, data: data.join('\n') };
}

async function postCommand(baseUrl: string, command: Command): Promise<{ status: number; body: CommandAck }> {
  const response = await fetch(`${baseUrl}${ENGINE_ROUTES.command}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  return { status: response.status, body: (await response.json()) as CommandAck };
}

const CMD = { commandId: 'cmd_test', traceId: 'trc_test', ts: 1 };

async function makeServer(options: { spec: ScriptedTaskSpec; brokerTimeoutMs?: number }) {
  const workspace = tempDir('camelia-serve-ws-');
  const script = scriptedTaskScript(options.spec);
  const handle: ProviderHandle = {
    id: 'mock',
    label: 'Scripted mock',
    model: 'scripted',
    models: ['scripted'],
    port: new MockProvider({ id: 'mock', models: ['scripted'], script }),
  };
  const broker = new ApprovalBroker({ timeoutMs: options.brokerTimeoutMs ?? 5_000 });
  const runtime = await CameliaRuntime.create({
    workspace,
    providerHandles: [handle],
    approvalResponder: broker.responder(),
    databaseFile: ':memory:',
    logLevel: 'error',
    logTo: () => undefined,
    // These tests exercise the tool gate. The plan gate is covered separately.
    planApproval: 'auto',
  });
  const server = new EngineServer({ runtime, broker, port: 0, offlineClarify: true });
  const address = await server.start();
  return { server, runtime, broker, address, workspace };
}

const servers: EngineServer[] = [];
const runtimes: CameliaRuntime[] = [];
const readers: SseReader[] = [];

afterEach(async () => {
  for (const reader of readers.splice(0)) reader.cancel();
  for (const server of servers.splice(0)) await server.stop();
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

describe('EngineServer — health and bootstrap', () => {
  it('answers /health with the session and no clients', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('health') });
    servers.push(server);
    runtimes.push(runtime);

    const response = await fetch(`${address.url}${ENGINE_ROUTES.health}`);
    const health = (await response.json()) as EngineHealth;
    expect(response.status).toBe(200);
    expect(health.ok).toBe(true);
    expect(health.sessionId).toBe(runtime.session.id);
    expect(health.clients).toBe(0);
  });

  // Iteration 25: the shell must be able to tell "no provider" from "not asked yet"
  // without starting a task, so the connection state rides on /health and bootstrap.
  it('reports the live provider status on /health', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('health-provider') });
    servers.push(server);
    runtimes.push(runtime);

    const response = await fetch(`${address.url}${ENGINE_ROUTES.health}`);
    const health = (await response.json()) as EngineHealth;
    const status = health.providerStatus;
    expect(status).toBeDefined();

    // Derived from the runtime's own chain, so it cannot drift from what a run would use.
    const chain = runtime.providerChain();
    const active = chain.find((entry) => entry.active);
    expect(status!.state).toBe(active ? 'connected' : 'unavailable');
    expect(status!.chain).toEqual(chain.map((entry) => entry.id));
    if (active) {
      expect(status!.id).toBe(active.id);
      expect(status!.model).toBe(runtime.modelInfo.model);
    }
  });

  it('carries the provider status on the bootstrap frame, before any event', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('bootstrap-provider') });
    servers.push(server);
    runtimes.push(runtime);

    const reader = await SseReader.open(`${address.url}${ENGINE_ROUTES.events}`);
    readers.push(reader);
    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.bootstrap));

    const payload = JSON.parse(reader.frames[0]!.data) as {
      providerStatus?: { state: string; chain: string[] };
    };
    expect(payload.providerStatus).toBeDefined();
    expect(payload.providerStatus!.chain).toEqual(runtime.providerChain().map((entry) => entry.id));
  });

  it('sends bootstrap before any domain event, then reports live', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('bootstrap') });
    servers.push(server);
    runtimes.push(runtime);

    const reader = await SseReader.open(`${address.url}${ENGINE_ROUTES.events}`);
    readers.push(reader);
    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.bootstrap));

    expect(reader.frames[0]!.event).toBe(SSE_FRAME.bootstrap);
    const payload = JSON.parse(reader.frames[0]!.data) as { session?: { id: string } };
    expect(payload.session?.id).toBe(runtime.session.id);
    expect(reader.frames.some((f) => f.event === SSE_FRAME.status && f.data.includes('live'))).toBe(true);
  });

  it('404s an unknown route', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('404') });
    servers.push(server);
    runtimes.push(runtime);
    const response = await fetch(`${address.url}/nope`);
    expect(response.status).toBe(404);
  });
});

describe('EngineServer — task lifecycle over the stream', () => {
  it('streams a full task from submit_task to task.completed', async () => {
    // Create-only spec: no privileged command, so the run needs no approval gate and the
    // plain lifecycle is what is under test here.
    const { server, runtime, address } = await makeServer({ spec: { create: { 'out.txt': 'ok\n' } } });
    servers.push(server);
    runtimes.push(runtime);

    const reader = await SseReader.open(`${address.url}${ENGINE_ROUTES.events}`);
    readers.push(reader);
    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.bootstrap));

    const ack = await postCommand(address.url, { type: 'submit_task', payload: { sessionId: runtime.session.id, intent: 'stream me', workspace: runtime.workspace }, ...CMD });
    expect(ack.status).toBe(200);
    expect(ack.body.ok).toBe(true);

    await reader.waitFor((frames) =>
      frames.some((f) => f.event === SSE_FRAME.domain && JSON.parse(f.data).type === 'task.completed'),
    );

    const types = reader.domains().map((e) => e.type);
    expect(types).toContain('task.received');
    expect(types).toContain('plan.ready');
    expect(types).toContain('step.completed');
    expect(types).toContain('verify.result');
    // Delivery is the last *meaningful* milestone; a trailing phase-change may follow it.
    expect(types.indexOf('task.completed')).toBeGreaterThan(types.indexOf('verify.result'));
    expect(reader.frames.some((f) => f.event === SSE_FRAME.status && f.data.includes('finished'))).toBe(true);
  }, 20_000);

  it('suspends on an approval gate and resumes when the UI approves', async () => {
    const spec: ScriptedTaskSpec = { create: { 'a.txt': 'hello\n' }, commands: ['node --version'] };
    const { server, runtime, address } = await makeServer({ spec });
    servers.push(server);
    runtimes.push(runtime);

    const reader = await SseReader.open(`${address.url}${ENGINE_ROUTES.events}`);
    readers.push(reader);
    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.bootstrap));

    await postCommand(address.url, { type: 'submit_task', payload: { sessionId: runtime.session.id, intent: 'gate me', workspace: runtime.workspace }, ...CMD });

    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.domain && JSON.parse(f.data).type === 'tool.approval_required'));
    const gate = reader.domains().find((e) => e.type === 'tool.approval_required')!;
    const callId = (gate.payload as { call: { id: string } }).call.id;

    // Approve for the session so a second gate (the verifier re-running the command) does not block.
    const ack = await postCommand(address.url, { type: 'approve_tool', payload: { callId, scope: 'session' }, ...CMD });
    expect(ack.body.ok).toBe(true);

    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.domain && ['task.completed', 'task.failed'].includes(JSON.parse(f.data).type)));

    const types = reader.domains().map((e) => e.type);
    expect(types).toContain('tool.approval_required');
    expect(types).toContain('tool.approved');
    expect(types).toContain('tool.finished');
    expect(types).toContain('task.completed');
  }, 20_000);

  it('denies a gate the UI answers with deny_tool, and the run still terminates', async () => {
    const spec: ScriptedTaskSpec = { create: { 'a.txt': 'hello\n' }, commands: ['node --version'] };
    const { server, runtime, address } = await makeServer({ spec, brokerTimeoutMs: 30_000 });
    servers.push(server);
    runtimes.push(runtime);

    const reader = await SseReader.open(`${address.url}${ENGINE_ROUTES.events}`);
    readers.push(reader);
    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.bootstrap));

    await postCommand(address.url, { type: 'submit_task', payload: { sessionId: runtime.session.id, intent: 'deny me', workspace: runtime.workspace }, ...CMD });
    await reader.waitFor((frames) => frames.some((f) => f.event === SSE_FRAME.domain && JSON.parse(f.data).type === 'tool.approval_required'));
    const callId = (reader.domains().find((e) => e.type === 'tool.approval_required')!.payload as { call: { id: string } }).call.id;

    const ack = await postCommand(address.url, { type: 'deny_tool', payload: { callId, reason: 'not now' }, ...CMD });
    expect(ack.body.ok).toBe(true);

    await reader.waitFor((frames) =>
      frames.some((f) => f.event === SSE_FRAME.domain && JSON.parse(f.data).type === 'tool.denied'),
    );
  }, 20_000);
});

describe('EngineServer — command dispatch honesty', () => {
  it('rejects a pause when 当前没有运行中的任务', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('idle') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'pause_task', payload: { taskId: 't1', reason: 'x' }, ...CMD });
    expect(ack.status).toBe(409);
    expect(ack.body.error).toContain('当前没有运行中的任务');
  });

  it('rejects an approval for an unknown call id', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('unknown') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'approve_tool', payload: { callId: 'call_missing', scope: 'once' }, ...CMD });
    expect(ack.body.ok).toBe(false);
    expect(ack.body.error).toContain('没有待审批');
  });

  it('rollback_step is wired through to the runtime (rejected when 当前没有运行中的任务)', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('rollback') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'rollback_step', payload: { taskId: 't1', checkpointId: 'ck1' }, ...CMD });
    expect(ack.body.ok).toBe(false);
    expect(ack.body.error).toContain('当前没有运行中的任务');
  });

  it('select_provider rejects an unknown provider id', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('prov') });
    servers.push(server);
    runtimes.push(runtime);
    const ack = await postCommand(address.url, { type: 'select_provider', payload: { providerId: 'does-not-exist' }, ...CMD });
    expect(ack.body.ok).toBe(false);
    expect(ack.body.error).toContain('不在链中');
  });

  it('rejects a malformed command body', async () => {
    const { server, runtime, address } = await makeServer({ spec: mockDemoSpec('bad') });
    servers.push(server);
    runtimes.push(runtime);
    const response = await fetch(`${address.url}${ENGINE_ROUTES.command}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });
});

describe('ApprovalBroker', () => {
  it('fails closed when a gate times out', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 20 });
    const responder = broker.responder();
    const approved = await responder({ callId: 'c1', name: 'shell.exec', risk: 'privileged', input: {}, reason: 'test' });
    expect(approved).toBe(false);
    expect(broker.stats().timedOut).toBe(1);
  });

  it('resolves a gate when the UI answers', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5_000 });
    const responder = broker.responder();
    const pending = responder({ callId: 'c2', name: 'shell.exec', risk: 'privileged', input: {}, reason: 'test' });
    expect(broker.size).toBe(1);
    expect(broker.settle('c2', true)).toBe(true);
    expect(await pending).toBe(true);
    expect(broker.settle('c2', true)).toBe(false);
  });

  it('denies every outstanding gate on shutdown', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5_000 });
    const responder = broker.responder();
    const first = responder({ callId: 'c3', name: 'shell.exec', risk: 'privileged', input: {}, reason: 'test' });
    expect(broker.rejectAll()).toBe(1);
    expect(await first).toBe(false);
  });
});