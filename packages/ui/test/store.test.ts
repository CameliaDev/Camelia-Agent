/**
 * Store tests.
 *
 * The store's one job is to be a faithful reducer over the event stream, so these tests
 * assert exactly that: given a scripted transport, the state matches the fold, dispatch
 * leaves the right command behind, and a broken transport degrades instead of crashing.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { Command } from '@camelia/core';

import { createUiStore, makeCommand } from '../src/state/store.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import type { Transport, TransportHandlers } from '../src/transport/types.js';

function command<T extends Command['type']>(type: T, payload: Command['payload']): Command {
  return { type, payload, commandId: `cmd_${type}`, traceId: `trc_${type}`, ts: 0 } as Command;
}

describe('createUiStore — bootstrap', () => {
  it('seeds sessions and the active session from the transport', () => {
    const store = createUiStore(new FixtureTransport({ scene: 'running' }));
    const state = store.getState();
    expect(state.sessions).toHaveLength(3);
    expect(state.activeSessionId).toBe(state.sessions[0]!.id);
    expect(state.snapshot.session?.id).toBe(state.sessions[0]!.id);
  });

  it('reports live once the fixture has replayed a running scene', () => {
    const store = createUiStore(new FixtureTransport({ scene: 'running' }));
    expect(store.getState().status).toBe('live');
    expect(store.getState().snapshot.task).toBeDefined();
  });

  it('has no task and an offline engine for the empty scene', () => {
    const store = createUiStore(new FixtureTransport({ scene: 'empty' }));
    const state = store.getState();
    expect(state.snapshot.task).toBeUndefined();
    expect(state.sessions).toEqual([]);
    expect(state.status).toBe('offline');
  });

  it('produces the same snapshot as folding the script directly', () => {
    const store = createUiStore(new FixtureTransport({ scene: 'done' }));
    const task = store.getState().snapshot.task!;
    expect(task.status).toBe('done');
    expect(task.steps).toHaveLength(5);
    expect(task.progress).toBe(1);
  });
});

describe('createUiStore — dispatch', () => {
  it('forwards the command to the transport and records it', () => {
    const transport = new FixtureTransport({ scene: 'running' });
    const store = createUiStore(transport);
    store.getState().dispatch(command('pause_task', { taskId: 'tsk_9c02af', reason: 'break' }));
    expect(transport.sent).toHaveLength(1);
    expect(store.getState().lastCommand?.type).toBe('pause_task');
  });

  it('applies the events a command provokes', () => {
    const transport = new FixtureTransport({ scene: 'approval' });
    const store = createUiStore(transport);
    expect(store.getState().snapshot.task!.approvals).toHaveLength(1);
    store.getState().dispatch(command('deny_tool', { callId: 'cal_07', reason: 'no' }));
    const task = store.getState().snapshot.task!;
    expect(task.approvals).toHaveLength(0);
    expect(task.toolCalls['cal_07']!.status).toBe('denied');
  });
});

describe('makeCommand', () => {
  it('builds a well-formed envelope', () => {
    const command = makeCommand('pause_task', { taskId: 't', reason: 'r' }, 'cmd_fixed');
    expect(command.type).toBe('pause_task');
    expect(command.commandId).toBe('cmd_fixed');
    expect(command.traceId).toBe('trc_cmd_fixed');
    expect(command.payload).toEqual({ taskId: 't', reason: 'r' });
  });
});

describe('createUiStore — failure handling', () => {
  it('degrades to offline when the transport cannot start', () => {
    const broken: Transport = {
      kind: 'sse',
      sent: [],
      start(_handlers: TransportHandlers): void {
        throw new Error('engine unreachable');
      },
      stop(): void {},
      send(): void {},
    };
    const store = createUiStore(broken);
    expect(store.getState().status).toBe('offline');
    expect(store.getState().transportError).toBe('engine unreachable');
  });
});