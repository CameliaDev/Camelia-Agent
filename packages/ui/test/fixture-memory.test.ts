/**
 * Fixture memory store — the offline half of the memory panel (Iteration 22).
 *
 * The fixture must answer the same query commands a live engine answers and react to
 * the same interventions with the same events, so scenes/tests exercise the identical
 * UI code path as `camelia serve`. These tests pin that contract — the fixture is a
 * stand-in, never a second engine, and it must not drift into a lie.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { Command, DomainEvent } from '@camelia/core';
import type { MemoryView } from '@camelia/agent/view';

import { FixtureTransport } from '../src/transport/fixture.js';
import type { BootstrapPayload, ConnectionStatus, TransportHandlers } from '../src/transport/types.js';

interface Recorder {
  events: DomainEvent[];
  statuses: ConnectionStatus[];
  bootstrap?: BootstrapPayload;
  results: Array<{ commandId: string; data: unknown }>;
}

function start(transport: FixtureTransport): Recorder {
  const recorder: Recorder = { events: [], statuses: [], results: [] };
  const handlers: TransportHandlers = {
    onEvent: (event) => recorder.events.push(event),
    onStatus: (status) => recorder.statuses.push(status),
    onBootstrap: (payload) => {
      recorder.bootstrap = payload;
    },
    onCommandResult: (commandId, data) => recorder.results.push({ commandId, data }),
  };
  transport.start(handlers);
  return recorder;
}

function cmd<T extends Command['type']>(type: T, payload: Command['payload'], commandId = `cmd_${type}`): Command {
  return { type, payload, commandId, traceId: `trc_${type}`, ts: 0 } as Command;
}

describe('FixtureTransport — memory queries (Iteration 22)', () => {
  it('answers list_memories with real fixture views, layer filter honoured', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);

    transport.send(cmd('list_memories', {}));
    const all = rec.results.at(-1)!.data as MemoryView[];
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.every((m) => typeof m.strength === 'number')).toBe(true);
    expect(all.some((m) => m.layer === 'procedural' && m.evidence)).toBe(true);

    transport.send(cmd('list_memories', { layer: 'long' }));
    const longs = rec.results.at(-1)!.data as MemoryView[];
    expect(longs.length).toBeGreaterThan(0);
    expect(longs.every((m) => m.layer === 'long')).toBe(true);
  });

  it('answers get_memory with one view, including the procedural evidence', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);

    transport.send(cmd('get_memory', { memoryId: 'mem_fixture_proc_1' }));
    const memory = rec.results.at(-1)!.data as MemoryView | null;
    expect(memory?.id).toBe('mem_fixture_proc_1');
    expect(memory?.evidence?.taskId).toBe('tsk_fixture_verify');

    transport.send(cmd('get_memory', { memoryId: 'mem_nope' }));
    expect(rec.results.at(-1)!.data).toBeNull();
  });

  it('answers list_forget_log and list_reactivation_due from the fixture store', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);

    transport.send(cmd('list_forget_log', {}));
    const log = rec.results.at(-1)!.data as Array<{ reason: string }>;
    expect(log[0]?.reason).toBe('user-correction');

    transport.send(cmd('list_reactivation_due', { limit: 2 }));
    const due = rec.results.at(-1)!.data as MemoryView[];
    expect(Array.isArray(due)).toBe(true);
  });

  it('answers get_memory_health with layer counts and a recall-noise rate', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);

    transport.send(cmd('get_memory_health', {}));
    const health = rec.results.at(-1)!.data as { totalMemories: number; byLayer: Record<string, number>; recallNoise: { noiseRate: number } };
    expect(health.totalMemories).toBeGreaterThan(0);
    expect(health.byLayer.long).toBeGreaterThan(0);
    expect(health.recallNoise.noiseRate).toBeGreaterThan(0);
  });
});

describe('FixtureTransport — memory interventions (Iteration 22)', () => {
  it('mark_memory_incorrect answers the command, mutates the store and emits memory.downgraded', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);

    transport.send(cmd('mark_memory_incorrect', { memoryId: 'mem_fixture_short_1', reason: 'user-correction' }));

    const answer = rec.results.find((r) => r.commandId === 'cmd_mark_memory_incorrect');
    expect(answer).toBeTruthy();
    const downgraded = rec.events.find((e) => e.type === 'memory.downgraded');
    expect((downgraded?.payload as { memoryId: string }).memoryId).toBe('mem_fixture_short_1');

    transport.send(cmd('get_memory', { memoryId: 'mem_fixture_short_1' }));
    expect((rec.results.at(-1)!.data as MemoryView).correctness).toBe(0);
  });

  it('forget_memory removes the item, answers and leaves an audit entry', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);

    transport.send(cmd('forget_memory', { memoryId: 'mem_fixture_short_2', reason: 'manual-test' }));
    const forgotten = rec.events.find((e) => e.type === 'memory.forgotten');
    expect(forgotten).toBeTruthy();
    expect((forgotten?.payload as { reason: string }).reason).toBe('manual-test');

    transport.send(cmd('list_forget_log', {}));
    const log = rec.results.at(-1)!.data as Array<{ memoryId: string; reason: string }>;
    expect(log[0]?.memoryId).toBe('mem_fixture_short_2');
    expect(log[0]?.reason).toBe('manual-test');

    transport.send(cmd('get_memory', { memoryId: 'mem_fixture_short_2' }));
    expect(rec.results.at(-1)!.data).toBeNull();
  });

  it('promote_memory upgrades the layer and emits memory.promoted', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);

    transport.send(cmd('promote_memory', { memoryId: 'mem_fixture_short_1' }));
    const promoted = rec.events.find((e) => e.type === 'memory.promoted');
    expect(promoted).toBeTruthy();
    expect((promoted?.payload as { reason: string }).reason).toBe('user-promotion');

    transport.send(cmd('get_memory', { memoryId: 'mem_fixture_short_1' }));
    const memory = rec.results.at(-1)!.data as MemoryView;
    expect(memory.layer).toBe('long');
    expect(memory.scope).toBe('global');
  });
});
