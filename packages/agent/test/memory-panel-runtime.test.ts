/**
 * Memory panel facade, asserted inside the agent package (Iteration 26 — Stage 1).
 *
 * Iteration 22's diagnosis: the panel's code paths were covered almost entirely
 * by *cli* real-engine tests and *ui* tests at runtime, so the agent package's
 * own coverage never saw them. These tests drive `CameliaRuntime.memoryPanel`
 * exactly as `EngineServer.dispatch` does — real store, real bus, real value
 * decomposition — and assert the observable results in the agent package.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ChatChunk, ChatRequest, LLMPort, MemoryItem } from '@camelia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CameliaRuntime } from '../src/runtime/CameliaRuntime.js';
import type { ProviderHandle } from '../src/ProviderRegistry.js';
import { MockProvider } from '../src/providers/MockProvider.js';
import { scriptedTaskScript, type ScriptedTaskSpec } from '../src/providers/ScriptedAgentProvider.js';

const runtimes: CameliaRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.close().catch(() => undefined)));
  vi.unstubAllEnvs();
});

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function scriptedHandle(spec: ScriptedTaskSpec): ProviderHandle {
  const inner = new MockProvider({ id: 'mock', models: ['scripted'], script: scriptedTaskScript(spec) });
  const port: LLMPort = {
    id: 'mock',
    capabilities: () => inner.capabilities(),
    listModels: () => inner.listModels(),
    async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
      yield* inner.chat(request, signal);
    },
  };
  return { id: 'mock', label: 'Scripted mock', model: 'scripted', models: ['scripted'], port };
}

async function harness(): Promise<CameliaRuntime> {
  const workspace = tempDir('camelia-panel-ws-');
  vi.stubEnv('CAMELIA_HOME', tempDir('camelia-panel-home-'));
  const runtime = await CameliaRuntime.create({
    workspace,
    providerHandles: [scriptedHandle({ create: { 'a.ts': 'x' } })],
    databaseFile: ':memory:',
    autoApprove: true,
    planApproval: 'auto',
    logLevel: 'error',
    logTo: () => undefined,
  });
  runtimes.push(runtime);
  return runtime;
}

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

describe('CameliaRuntime.memoryPanel — queries (agent-internal, real store)', () => {
  it('lists memories with the engine value decomposition, filterable by layer', async () => {
    const runtime = await harness();
    await writeMemory(runtime, { id: 'mem_a', content: 'pnpm build is the build command', keywords: 'pnpm build', layer: 'long', importance: 0.8 });
    await writeMemory(runtime, { id: 'mem_b', content: 'the fixture port is 5173', keywords: 'fixture port', scope: 'session', sessionId: runtime.session.id, layer: 'short' });

    const all = await runtime.memoryPanel.list();
    expect(all.map((m) => m.id).sort()).toEqual(['mem_a', 'mem_b']);
    for (const view of all) {
      expect(typeof view.strength).toBe('number');
      expect(typeof view.recency).toBe('number');
      expect(view.createdAt).toBeGreaterThan(0);
    }

    const longs = await runtime.memoryPanel.list({ layer: 'long' });
    expect(longs.map((m) => m.id)).toEqual(['mem_a']);
    expect(longs[0]!.layer).toBe('long');
  });

  it('scopes the list to one session and keeps cross-session memories out of it', async () => {
    // The panel answers "what did *this task* learn?". Before the scope existed the list
    // was every memory in the database, which is why the panel read as noise: the reader
    // could not tell which rows belonged to the task in front of them. This pins the
    // distinction between the panel's scoped view and Settings' unscoped one.
    const runtime = await harness();
    const otherSession = 'ses_somewhere_else';
    await writeMemory(runtime, { id: 'mem_g', content: 'a global fact', scope: 'global', layer: 'long' });
    await writeMemory(runtime, { id: 'mem_here', content: 'this task learned it', scope: 'session', sessionId: runtime.session.id, layer: 'short' });
    await writeMemory(runtime, { id: 'mem_there', content: 'another task learned it', scope: 'session', sessionId: otherSession, layer: 'short' });

    // Unscoped — the Settings view sees everything.
    const all = await runtime.memoryPanel.list();
    expect(all.map((m) => m.id).sort()).toEqual(['mem_g', 'mem_here', 'mem_there']);

    // Scoped — only this session. The global row must NOT leak in; that is the point.
    const here = await runtime.memoryPanel.list({ sessionId: runtime.session.id });
    expect(here.map((m) => m.id)).toEqual(['mem_here']);

    // Scope composes with the layer tab rather than overriding it.
    expect(await runtime.memoryPanel.list({ sessionId: runtime.session.id, layer: 'long' })).toEqual([]);
  });

  it('gets one memory with evidence, and null for an unknown id', async () => {
    const runtime = await harness();
    await writeMemory(runtime, {
      id: 'mem_ev', content: 'scaffold recipe', keywords: 'recipe', kind: 'procedural', layer: 'procedural',
      evidence: { taskId: 'tsk_v1', verdict: 'pass', at: Date.now() },
    });

    const view = await runtime.memoryPanel.get('mem_ev');
    expect(view?.id).toBe('mem_ev');
    expect(view?.evidence?.taskId).toBe('tsk_v1');
    expect(view?.evidence?.verdict).toBe('pass');

    expect(await runtime.memoryPanel.get('mem_nope')).toBeNull();
  });

  it('reports the reactivation queue from the engine', async () => {
    const runtime = await harness();
    const now = Date.now();
    await writeMemory(runtime, { id: 'mem_due', content: 'staging key in the vault', keywords: 'vault', importance: 0.9, nextReviewAt: now - 1 });
    await writeMemory(runtime, { id: 'mem_not_due', content: 'irrelevant trivia', keywords: 'trivia', importance: 0.1, nextReviewAt: now + 24 * 60 * 60 * 1000 });

    const due = await runtime.memoryPanel.reactivationDue(3);
    expect(due.map((m) => m.id)).toContain('mem_due');
    expect(due.map((m) => m.id)).not.toContain('mem_not_due');
  });

  it('reports health: layer counts and the cross-session recall-noise rate', async () => {
    const runtime = await harness();
    await writeMemory(runtime, { id: 'mem_h1', content: 'a long fact', keywords: 'a', layer: 'long' });
    await writeMemory(runtime, { id: 'mem_h2', content: 'a short fact', keywords: 'b', scope: 'session', sessionId: runtime.session.id, layer: 'short' });

    const health = await runtime.memoryPanel.health();
    expect(health.totalMemories).toBe(2);
    expect(health.byLayer.long).toBe(1);
    expect(health.byLayer.short).toBe(1);
    expect(health.recallNoise.noiseRate).toBe(0);
  });

  it('recallTimeline folds persisted memory.recalled events with layer, via, noise and the downgrade mark (Iteration 26)', async () => {
    const runtime = await harness();
    await writeMemory(runtime, { id: 'mem_tl_a', content: 'the staging key lives in the vault', keywords: 'vault', layer: 'long', importance: 0.9 });
    await writeMemory(runtime, { id: 'mem_tl_b', content: 'the fixture port is 5173', keywords: 'fixture port', scope: 'session', sessionId: runtime.session.id, layer: 'short' });

    const sessionId = runtime.session.id;
    // Two persisted recalls: the short memory is later judged incorrect.
    runtime.bus.emit(
      'memory.recalled',
      { count: 2, ids: ['mem_tl_a', 'mem_tl_b'], noise: 0.5, provenance: [
        { memoryId: 'mem_tl_a', layer: 'long', matchedBy: 'vault' },
        { memoryId: 'mem_tl_b', layer: 'short', matchedBy: 'port' },
      ] },
      { traceId: 'trc_tl', sessionId, taskId: 'tsk_tl', ts: 1_000 },
    );
    runtime.bus.emit(
      'memory.recalled',
      { count: 1, ids: ['mem_tl_a'], noise: 0, provenance: [{ memoryId: 'mem_tl_a', layer: 'long', matchedBy: 'staging' }] },
      { traceId: 'trc_tl2', sessionId, taskId: 'tsk_tl2', ts: 2_000 },
    );
    runtime.bus.emit(
      'memory.downgraded',
      { memoryId: 'mem_tl_b', reason: 'user-correction', correctness: 0 },
      { traceId: 'trc_dg', sessionId, taskId: 'tsk_tl', ts: 3_000 },
    );
    await runtime.flush();

    const hits = await runtime.memoryPanel.recallTimeline({ sessionId });
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.at)).toEqual([1_000, 1_000, 2_000]); // chronological
    expect(hits[0]).toMatchObject({ memoryId: 'mem_tl_a', layer: 'long', matchedBy: 'vault', noise: 0.5, downgraded: false });
    expect(hits[0]!.contentSnippet).toContain('staging key');
    expect(hits[1]).toMatchObject({ memoryId: 'mem_tl_b', layer: 'short', matchedBy: 'port', noise: 0.5, downgraded: true });
    expect(hits[2]).toMatchObject({ memoryId: 'mem_tl_a', matchedBy: 'staging', noise: 0, downgraded: false });

    // Filters: only one memory, or the most recent hit.
    expect((await runtime.memoryPanel.recallTimeline({ memoryId: 'mem_tl_b' })).map((h) => h.memoryId)).toEqual(['mem_tl_b']);
    expect((await runtime.memoryPanel.recallTimeline({ limit: 1 })).map((h) => h.at)).toEqual([2_000]);
  });
});

describe('CameliaRuntime.memoryPanel — interventions (agent-internal, real store)', () => {
  it('markIncorrect downgrades correctness to 0 and emits memory.downgraded', async () => {
    const runtime = await harness();
    await writeMemory(runtime, { id: 'mem_bad', content: 'a recipe that failed verification', keywords: 'recipe', kind: 'procedural', layer: 'procedural', importance: 0.8 });

    const seen: string[] = [];
    const detach = runtime.bus.onAny((event) => {
      if (event.type === 'memory.downgraded') seen.push((event.payload as { memoryId: string }).memoryId);
    });
    const result = await runtime.memoryPanel.markIncorrect('mem_bad', 'user-correction');
    detach();

    expect(result.ok).toBe(true);
    expect(seen).toEqual(['mem_bad']);
    expect((await runtime.memoryPanel.get('mem_bad'))?.correctness).toBe(0);
  });

  it('markIncorrect on a missing memory returns an honest error', async () => {
    const runtime = await harness();
    const result = await runtime.memoryPanel.markIncorrect('mem_nope', 'user-correction');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('memory not found');
  });

  it('forget removes the item and leaves an audit-trail entry', async () => {
    const runtime = await harness();
    await writeMemory(runtime, { id: 'mem_gone', content: 'transient token format details', keywords: 'token format' });

    const result = await runtime.memoryPanel.forget('mem_gone', 'manual-test');
    expect(result.ok).toBe(true);
    expect(await runtime.memoryPanel.get('mem_gone')).toBeNull();

    const log = await runtime.memoryPanel.forgetLog();
    expect(log[0]?.memoryId).toBe('mem_gone');
    expect(log[0]?.reason).toBe('manual-test');
    expect(log[0]?.contentSnippet).toContain('transient token');
  });

  it('forget on a missing memory returns an honest error', async () => {
    const runtime = await harness();
    const result = await runtime.memoryPanel.forget('mem_nope', 'manual');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('memory not found');
  });

  it('promote upgrades a short-term memory to long-term/global and emits memory.promoted', async () => {
    const runtime = await harness();
    await writeMemory(runtime, { id: 'mem_p', content: 'user wants this kept', keywords: 'keep', scope: 'session', sessionId: runtime.session.id, layer: 'short' });

    const seen: string[] = [];
    const detach = runtime.bus.onAny((event) => {
      if (event.type === 'memory.promoted') seen.push((event.payload as { memoryId: string }).memoryId);
    });
    const result = await runtime.memoryPanel.promote('mem_p');
    detach();

    expect(result.ok).toBe(true);
    expect(seen).toEqual(['mem_p']);
    const view = await runtime.memoryPanel.get('mem_p');
    expect(view?.layer).toBe('long');
    expect(view?.scope).toBe('global');
  });

  it('promote on a missing memory returns an honest error', async () => {
    const runtime = await harness();
    const result = await runtime.memoryPanel.promote('mem_nope');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('memory not found');
  });
});
