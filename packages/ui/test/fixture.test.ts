/**
 * Fixture-transport tests.
 *
 * The fixture is a stand-in for a live engine, so the two contracts it must honour are:
 * bootstrap lands before the event stream, and every user command produces the same
 * domain events the real `harness` would emit. If either drifts, the UI is being tested
 * against a lie.
 * @module
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Command, DomainEvent } from '@camelia/core';

import { FixtureTransport } from '../src/transport/fixture.js';
import { buildScenario } from '../src/transport/scenario.js';
import type { BootstrapPayload, ConnectionStatus, TransportHandlers } from '../src/transport/types.js';

interface Recorder {
  events: DomainEvent[];
  statuses: ConnectionStatus[];
  bootstrap?: BootstrapPayload;
}

function start(transport: FixtureTransport): Recorder {
  const recorder: Recorder = { events: [], statuses: [] };
  const handlers: TransportHandlers = {
    onEvent: (event) => recorder.events.push(event),
    onStatus: (status) => recorder.statuses.push(status),
    onBootstrap: (payload) => {
      recorder.bootstrap = payload;
    },
  };
  transport.start(handlers);
  return recorder;
}

function cmd<T extends Command['type']>(type: T, payload: Command['payload']): Command {
  return { type, payload, commandId: `cmd_${type}`, traceId: `trc_${type}`, ts: 0 } as Command;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FixtureTransport — bootstrap and replay', () => {
  it('delivers bootstrap before any event', () => {
    const transport = new FixtureTransport({ scene: 'running' });
    const order: string[] = [];
    transport.start({
      onEvent: () => order.push('event'),
      onStatus: () => order.push('status'),
      onBootstrap: () => order.push('bootstrap'),
    });
    expect(order).toContain('bootstrap');
    expect(order.indexOf('bootstrap')).toBeLessThan(order.indexOf('event'));
  });

  it('replays the whole script for the requested scene', () => {
    const transport = new FixtureTransport({ scene: 'done' });
    const rec = start(transport);
    expect(rec.events).toHaveLength(buildScenario('done').length);
    expect(rec.statuses).toContain('finished');
  });

  it('reports no session and an offline engine for the empty scene', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);
    expect(rec.events).toEqual([]);
    expect(rec.bootstrap?.sessions).toEqual([]);
    expect(rec.bootstrap?.session).toBeUndefined();
    expect(rec.statuses.at(-1)).toBe('offline');
  });

  it('honours the script timestamps when replay is timed', () => {
    vi.useFakeTimers();
    const transport = new FixtureTransport({ scene: 'planning', replay: 'timed' });
    const rec = start(transport);
    expect(rec.events).toHaveLength(0);
    vi.runAllTimers();
    expect(rec.events).toHaveLength(buildScenario('planning').length);
  });

  it('stops cleanly, cancelling pending timers', () => {
    vi.useFakeTimers();
    const transport = new FixtureTransport({ scene: 'done', replay: 'timed' });
    const rec = start(transport);
    transport.stop();
    vi.runAllTimers();
    expect(rec.events).toHaveLength(0);
  });

  it('replays the diff scene up to the open edit', () => {
    const transport = new FixtureTransport({ scene: 'diff' });
    const rec = start(transport);
    expect(rec.events).toHaveLength(buildScenario('diff').length);
    expect(rec.statuses.at(-1)).toBe('live');
  });

  it('refuses to start for the error scene, so the store can surface it', () => {
    const transport = new FixtureTransport({ scene: 'error' });
    expect(() => start(transport)).toThrow(/engine unreachable/);
  });
});

describe('FixtureTransport — commands produce engine events', () => {
  it('records every command it receives', () => {
    const transport = new FixtureTransport({ scene: 'approval' });
    start(transport);
    transport.send(cmd('deny_tool', { callId: 'cal_07', reason: 'not now' }));
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.type).toBe('deny_tool');
  });

  it('approving a tool emits approved → started → finished', () => {
    const transport = new FixtureTransport({ scene: 'approval' });
    const rec = start(transport);
    rec.events.length = 0;
    transport.send(cmd('approve_tool', { callId: 'cal_07', scope: 'once' }));
    expect(rec.events.map((e) => e.type)).toEqual(['tool.approved', 'tool.started', 'tool.finished']);
    const finished = rec.events.at(-1)!;
    if (finished.type === 'tool.finished') {
      expect(finished.payload.call.status).toBe('ok');
      expect(finished.payload.call.output).toBeDefined();
    }
  });

  it('denying a tool emits tool.denied', () => {
    const transport = new FixtureTransport({ scene: 'approval' });
    const rec = start(transport);
    rec.events.length = 0;
    transport.send(cmd('deny_tool', { callId: 'cal_07', reason: 'no' }));
    expect(rec.events.map((e) => e.type)).toEqual(['tool.denied']);
  });

  it('pause / resume / cancel map to task lifecycle events', () => {
    const transport = new FixtureTransport({ scene: 'running' });
    const rec = start(transport);
    rec.events.length = 0;
    transport.send(cmd('pause_task', { taskId: 'tsk_9c02af', reason: 'break' }));
    transport.send(cmd('resume_task', { taskId: 'tsk_9c02af' }));
    transport.send(cmd('cancel_task', { taskId: 'tsk_9c02af', reason: 'stop' }));
    expect(rec.events.map((e) => e.type)).toEqual(['task.paused', 'task.resumed', 'task.cancelled']);
  });

  it('steering re-anchors the goal', () => {
    const transport = new FixtureTransport({ scene: 'running' });
    const rec = start(transport);
    rec.events.length = 0;
    transport.send(cmd('intervene_goal', { taskId: 'tsk_9c02af', instruction: 'also update the README' }));
    const event = rec.events[0]!;
    expect(event.type).toBe('task.intervened');
    if (event.type === 'task.intervened') {
      expect(event.payload.newGoal).toBe('also update the README');
    }
  });

  it('rollback emits start and done', () => {
    const transport = new FixtureTransport({ scene: 'done' });
    const rec = start(transport);
    rec.events.length = 0;
    transport.send(cmd('rollback_step', { taskId: 'tsk_9c02af', checkpointId: 'ckp_03' }));
    expect(rec.events.map((e) => e.type)).toEqual(['recovery.rollback_started', 'recovery.rollback_done']);
  });

  it('provider selection emits provider.selected', () => {
    const transport = new FixtureTransport({ scene: 'failure' });
    const rec = start(transport);
    rec.events.length = 0;
    transport.send(cmd('select_provider', { providerId: 'ollama', model: 'qwen2.5-coder:7b' }));
    expect(rec.events.map((e) => e.type)).toEqual(['provider.selected']);
  });

  it('submitting a task walks intake → planning → executing', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const rec = start(transport);
    rec.events.length = 0;
    transport.send(cmd('submit_task', { sessionId: 'ses_new', intent: 'add a LICENSE', workspace: 'C:/w' }));
    const types = rec.events.map((e) => e.type);
    expect(types[0]).toBe('task.received');
    expect(types).toContain('plan.ready');
    expect(types).toContain('task.phase_changed');
    expect(rec.statuses.at(-1)).toBe('live');
  });

  it('ignores commands before start', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    expect(() => transport.send(cmd('pause_task', { taskId: 't', reason: 'r' }))).not.toThrow();
    expect(transport.sent).toHaveLength(1);
  });
});