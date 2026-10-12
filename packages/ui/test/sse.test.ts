/**
 * SSE transport tests.
 *
 * The live transport must be indistinguishable from the fixture to everything above it.
 * These tests drive it with a fake `EventSource` and a fake `fetch` — the two seams that
 * exist precisely so this can run in Node, where neither global is present. They pin the
 * wire contract (`bootstrap` → `domain` → `status` frames), the command path, and the
 * error channel that makes a dead engine visible instead of silently empty.
 * @module
 */

import { describe, expect, it, vi } from 'vitest';

import { ENGINE_ROUTES, SSE_FRAME } from '@camelia/agent/view';

import { SseTransport, type EventSourceLike } from '../src/transport/sse.js';
import { createTransport } from '../src/transport/index.js';
import type { ConnectionStatus, TransportHandlers } from '../src/transport/types.js';

type Listener = (event: { data: string }) => void;

class FakeEventSource implements EventSourceLike {
  static last?: FakeEventSource;
  readonly listeners = new Map<string, Listener[]>();
  onopen: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

function makeHandlers() {
  const events: unknown[] = [];
  const statuses: ConnectionStatus[] = [];
  const bootstraps: unknown[] = [];
  const errors: string[] = [];
  const rejected: Array<{ commandId: string; type: string; error: string }> = [];
  const handlers: TransportHandlers = {
    onEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status),
    onBootstrap: (payload) => bootstraps.push(payload),
    onError: (message) => errors.push(message),
    onCommandRejected: (commandId, type, error) => rejected.push({ commandId, type, error }),
  };
  return { handlers, events, statuses, bootstraps, errors, rejected };
}

function transport(overrides: Partial<{ fetchImpl: typeof fetch }> = {}) {
  const created: FakeEventSource[] = [];
  const instance = new SseTransport({
    baseUrl: 'http://127.0.0.1:7433',
    eventSource: (url) => {
      const source = new FakeEventSource(url);
      created.push(source);
      return source;
    },
    fetchImpl: overrides.fetchImpl ?? (vi.fn(async () => new Response(JSON.stringify({ ok: true }))) as unknown as typeof fetch),
  });
  return { instance, created };
}

describe('SseTransport — URL composition', () => {
  it('targets the engine event route, trimming a trailing slash', () => {
    const instance = new SseTransport({ baseUrl: 'http://127.0.0.1:7433/' });
    expect(instance.eventsUrl).toBe(`http://127.0.0.1:7433${ENGINE_ROUTES.events}`);
  });

  it('scopes the stream to a session when one is given', () => {
    const instance = new SseTransport({ baseUrl: 'http://127.0.0.1:7433', sessionId: 'ses 1' });
    expect(instance.eventsUrl).toBe(`http://127.0.0.1:7433${ENGINE_ROUTES.events}?sessionId=ses%201`);
  });
});

describe('SseTransport — stream handling', () => {
  it('reports connecting, then live once the socket opens', () => {
    const { instance, created } = transport();
    const h = makeHandlers();
    instance.start(h.handlers);
    expect(h.statuses).toEqual(['connecting']);
    created[0]!.onopen?.({});
    expect(h.statuses).toEqual(['connecting', 'live']);
  });

  it('delivers the bootstrap payload and flips to live', () => {
    const { instance, created } = transport();
    const h = makeHandlers();
    instance.start(h.handlers);
    created[0]!.emit(SSE_FRAME.bootstrap, JSON.stringify({ sessions: [], provider: { activeProvider: 'mock' } }));
    expect(h.bootstraps).toHaveLength(1);
    expect(h.statuses.at(-1)).toBe('live');
  });

  it('forwards domain events verbatim', () => {
    const { instance, created } = transport();
    const h = makeHandlers();
    instance.start(h.handlers);
    const event = { type: 'task.received', payload: { task: { id: 't1' } }, traceId: 'trc', ts: 1 };
    created[0]!.emit(SSE_FRAME.domain, JSON.stringify(event));
    expect(h.events).toEqual([event]);
  });

  it('maps a status frame onto the connection status', () => {
    const { instance, created } = transport();
    const h = makeHandlers();
    instance.start(h.handlers);
    created[0]!.emit(SSE_FRAME.status, JSON.stringify({ status: 'finished' }));
    expect(h.statuses.at(-1)).toBe('finished');
  });

  it('surfaces a malformed frame through the error channel without throwing', () => {
    const { instance, created } = transport();
    const h = makeHandlers();
    instance.start(h.handlers);
    created[0]!.emit(SSE_FRAME.domain, '{not json');
    expect(h.errors[0]).toContain('malformed event frame');
  });

  it('reports offline when the socket errors, and closes on stop', () => {
    const { instance, created } = transport();
    const h = makeHandlers();
    instance.start(h.handlers);
    created[0]!.onerror?.({});
    expect(h.statuses.at(-1)).toBe('offline');
    instance.stop();
    expect(created[0]!.closed).toBe(true);
  });
});

describe('SseTransport — commands', () => {
  const command = {
    type: 'pause_task',
    payload: { taskId: 't1', reason: 'stop' },
    commandId: 'cmd_1',
    traceId: 'trc_1',
    ts: 1,
  } as const;

  it('records the intent synchronously and posts it to the command route', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    const { instance } = transport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    instance.start(makeHandlers().handlers);
    instance.send(command as never);
    expect(instance.sent).toEqual([command]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:7433${ENGINE_ROUTES.command}`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(command);
  });

  it('reports a rejected command through the error channel', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'no task is running' })));
    const { instance } = transport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const h = makeHandlers();
    instance.start(h.handlers);
    instance.send(command as never);
    await vi.waitFor(() => expect(h.rejected.map((r) => r.error)).toContain('no task is running'));
  });

  it('reports a failed send through the error channel', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const { instance } = transport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const h = makeHandlers();
    instance.start(h.handlers);
    instance.send(command as never);
    await vi.waitFor(() => expect(h.errors[0]).toContain('failed to send'));
  });

  it('routes an accepted query answer to onCommandResult with the commandId (Iteration 22)', async () => {
    const data = [{ id: 'mem_1', layer: 'long', strength: 0.72 }];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data })));
    const { instance } = transport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const results: Array<{ commandId: string; data: unknown }> = [];
    const h = makeHandlers();
    h.handlers.onCommandResult = (commandId, payload) => results.push({ commandId, data: payload });
    instance.start(h.handlers);
    instance.send({ ...command, type: 'list_memories', payload: {} } as never);
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]!.commandId).toBe('cmd_1');
    expect(results[0]!.data).toEqual(data);
    expect(h.errors).toHaveLength(0);
  });

  it('answers accepted intent commands through onCommandResult too (no data) — the caller never hangs (Iteration 22)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    const { instance } = transport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const results: unknown[] = [];
    const h = makeHandlers();
    h.handlers.onCommandResult = (_commandId, payload) => results.push(payload);
    instance.start(h.handlers);
    instance.send(command as never);
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toBeUndefined();
  });
});

describe('createTransport — engine vs fixture selection', () => {
  it('prefers a live engine from the URL over any scene', () => {
    const instance = createTransport('?scene=done&engineUrl=http://127.0.0.1:7433');
    expect(instance.kind).toBe('sse');
    expect((instance as SseTransport).eventsUrl).toContain('http://127.0.0.1:7433');
  });

  it('falls back to the fixture when no engine is configured', () => {
    expect(createTransport('?scene=diff').kind).toBe('fixture');
  });
});