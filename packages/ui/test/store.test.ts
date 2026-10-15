/**
 * Store tests.
 *
 * The store's one job is to be a faithful reducer over the event stream, so these tests
 * assert exactly that: given a scripted transport, the state matches the fold, dispatch
 * leaves the right command behind, and a broken transport degrades instead of crashing.
 * @module
 */

import { describe, expect, it, vi } from 'vitest';

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

describe('createUiStore — session switch', () => {
  it('drops the previous chat when bootstrap arrives after activeSessionId was already set', () => {
    const { transport, handlers } = manualTransport();
    const store = createUiStore(transport);
    const oldSession = {
      id: 'ses_old',
      title: 'hello',
      workspace: 'C:/ws',
      provider: 'ollama',
      model: 'qwen',
    };
    handlers().onBootstrap({ session: oldSession, sessions: [oldSession] });
    handlers().onEvent({
      type: 'chat.received',
      payload: { turnId: 'turn_01', text: 'hello' },
      traceId: 'trc',
      ts: 1,
    } as never);
    expect(store.getState().snapshot.chat.turns).toHaveLength(1);

    store.getState().setActiveSession('ses_blank_work');
    const blank = {
      id: 'ses_blank_work',
      title: '新会话',
      workspace: 'C:/ws',
      provider: 'ollama',
      model: 'qwen',
      kind: 'work' as const,
      blank: true,
    };
    handlers().onBootstrap({ session: blank, sessions: [blank, oldSession] });

    const state = store.getState();
    expect(state.activeSessionId).toBe('ses_blank_work');
    expect(state.snapshot.session?.id).toBe('ses_blank_work');
    expect(state.snapshot.session?.title).toBe('新会话');
    expect(state.snapshot.chat.turns).toHaveLength(0);
  });

  it('replays the stream when select_session targets the already-active id', () => {
    const { transport, handlers } = manualTransport();
    const switchSession = vi.fn();
    (transport as { switchSession?: (id: string, opts?: { force?: boolean }) => void }).switchSession = switchSession;
    const store = createUiStore(transport);
    const session = {
      id: 'ses_old',
      title: 'long running task title',
      workspace: 'C:/ws',
      provider: 'ollama',
      model: 'qwen',
      kind: 'work' as const,
    };
    handlers().onBootstrap({ session, sessions: [session] });
    store.getState().dispatch(makeCommand('select_session', { sessionId: session.id }));
    expect(switchSession).toHaveBeenCalledWith(session.id, { force: true });
  });

  it('keeps the transcript when bootstrap is a reconnect of the same session', () => {
    const { transport, handlers } = manualTransport();
    const store = createUiStore(transport);
    const session = {
      id: 'ses_old',
      title: 'hello',
      workspace: 'C:/ws',
      provider: 'ollama',
      model: 'qwen',
    };
    handlers().onBootstrap({ session, sessions: [session] });
    handlers().onEvent({
      type: 'chat.received',
      payload: { turnId: 'turn_01', text: 'hello' },
      traceId: 'trc',
      ts: 1,
    } as never);
    handlers().onBootstrap({ session, sessions: [session] });
    expect(store.getState().snapshot.chat.turns).toHaveLength(1);
  });
});

describe('createUiStore — dispatch', () => {
  it('forwards the command to the transport and records it', () => {
    const transport = new FixtureTransport({ scene: 'running' });
    const store = createUiStore(transport);
    store.getState().dispatch(command('pause_task', { taskId: 'tsk_9c02af', reason: 'break' }));
    expect(transport.sent.some((c) => c.type === 'list_plugins')).toBe(true);
    expect(transport.sent.filter((c) => c.type === 'pause_task')).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// provider connection state (Iteration 25)
// ---------------------------------------------------------------------------

/** A transport that captures its handlers so a test can drive the callbacks directly. */
function manualTransport(): { transport: Transport; handlers: () => TransportHandlers } {
  let captured: TransportHandlers | undefined;
  return {
    transport: {
      kind: 'sse',
      sent: [],
      start(handlers: TransportHandlers): void {
        captured = handlers;
      },
      stop(): void {},
      send(): void {},
    },
    handlers: () => {
      if (!captured) throw new Error('transport was never started');
      return captured;
    },
  };
}

describe('createUiStore — provider status', () => {
  it('seeds the connection state from bootstrap, before any task exists', () => {
    const { transport, handlers } = manualTransport();
    const store = createUiStore(transport);

    // No task has run — the header still has to say whether a provider resolved.
    expect(store.getState().snapshot.task).toBeUndefined();

    handlers().onBootstrap({
      sessions: [],
      providerStatus: { state: 'connected', id: 'aliyun', model: 'qwen-plus', chain: ['aliyun', 'ollama'] },
    });

    const provider = store.getState().snapshot.provider;
    expect(provider.connected).toBe(true);
    expect(provider.activeProvider).toBe('aliyun');
    expect(provider.activeModel).toBe('qwen-plus');
    expect(provider.chain).toEqual(['aliyun', 'ollama']);
  });

  it('accepts a provider status arriving out of band via onProviderStatus', () => {
    const { transport, handlers } = manualTransport();
    const store = createUiStore(transport);
    handlers().onProviderStatus?.({ state: 'connected', id: 'ollama', model: 'qwen2.5-coder:7b', chain: ['ollama'] });
    expect(store.getState().snapshot.provider.activeProvider).toBe('ollama');
  });

  it('records an unavailable engine without inventing a provider name', () => {
    const { transport, handlers } = manualTransport();
    const store = createUiStore(transport);
    handlers().onBootstrap({ sessions: [], providerStatus: { state: 'unavailable', chain: [] } });
    const provider = store.getState().snapshot.provider;
    expect(provider.connected).toBe(false);
    expect(provider.activeProvider).toBeUndefined();
  });

  it('leaves the connection state unknown when bootstrap carries no provider status', () => {
    const { transport, handlers } = manualTransport();
    const store = createUiStore(transport);
    handlers().onBootstrap({ sessions: [] });
    // `undefined`, not `false`: the UI must be able to tell "still connecting" from
    // "the engine answered and has no provider".
    expect(store.getState().snapshot.provider.connected).toBeUndefined();
  });

  it('lets a run event override the boot-time provider', () => {
    const { transport, handlers } = manualTransport();
    const store = createUiStore(transport);
    handlers().onBootstrap({
      sessions: [],
      providerStatus: { state: 'connected', id: 'aliyun', model: 'qwen-plus', chain: ['aliyun'] },
    });
    handlers().onEvent({
      type: 'provider.selected',
      payload: { providerId: 'openrouter', model: 'qwen3-coder:free', reason: 'cheap-first' },
      traceId: 'trc',
      ts: 1,
    } as never);
    const provider = store.getState().snapshot.provider;
    expect(provider.activeProvider).toBe('openrouter');
    expect(provider.connected).toBe(true);
  });
});