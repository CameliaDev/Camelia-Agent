/**
 * SSE transport — the live half of the transport contract.
 *
 * Same interface as the fixture, different source of truth: domain events arrive from
 * `camelia serve` over `EventSource`, and commands leave over `POST /command`. The UI
 * code above this line cannot tell the two apart, which is exactly the point — the
 * webview is a projection of the engine's stream whether the engine is real or scripted.
 *
 * Both `EventSource` and `fetch` are injectable so the transport is testable in Node,
 * where neither global exists.
 * @module
 */

import type { Command, DomainEvent } from '@camelia/core';
import { ENGINE_ROUTES, SSE_FRAME, type CommandAck, type EngineHealth } from '@camelia/agent/view';

import type { BootstrapPayload, ConnectionStatus, Transport, TransportHandlers } from './types.js';

/** The slice of `EventSource` this transport uses — keeps the DOM lib out of tests. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface SseTransportOptions {
  /** Engine base URL, e.g. `http://127.0.0.1:7433`. */
  baseUrl: string;
  /** Attach to a specific session instead of the engine's default. */
  sessionId?: string;
  /** Injectable for tests; defaults to the global `EventSource`. */
  eventSource?: (url: string) => EventSourceLike;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class SseTransport implements Transport {
  readonly kind = 'sse' as const;
  readonly sent: Command[] = [];

  private handlers?: TransportHandlers;
  private source?: EventSourceLike;
  private stopped = false;

  constructor(private readonly options: SseTransportOptions) {}

  /** The `/events` URL, session-scoped when a session was requested. */
  get eventsUrl(): string {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const query = this.options.sessionId ? `?sessionId=${encodeURIComponent(this.options.sessionId)}` : '';
    return `${base}${ENGINE_ROUTES.events}${query}`;
  }

  start(handlers: TransportHandlers): void {
    this.handlers = handlers;
    this.stopped = false;
    handlers.onStatus('connecting');

    // Probe `/health` before the stream: the bootstrap frame answers "which sessions
    // exist", but a freshly booted engine has no session yet and the header still has to
    // say whether a provider resolved. The probe is cheap, non-blocking and best-effort —
    // a failure just means the bootstrap frame is the only source.
    void this.probeHealth();

    const factory = this.options.eventSource ?? defaultEventSource;
    const source = factory(this.eventsUrl);
    this.source = source;

    source.onopen = () => handlers.onStatus('live');
    source.onerror = () => {
      // EventSource retries on its own; surface the gap rather than hiding it.
      if (!this.stopped) handlers.onStatus('offline');
    };

    source.addEventListener(SSE_FRAME.bootstrap, (event) => {
      try {
        handlers.onBootstrap(JSON.parse(event.data) as BootstrapPayload);
        handlers.onStatus('live');
      } catch (error) {
        handlers.onError?.(`malformed bootstrap frame: ${String(error)}`);
      }
    });

    source.addEventListener(SSE_FRAME.domain, (event) => {
      try {
        handlers.onEvent(JSON.parse(event.data) as DomainEvent);
      } catch (error) {
        handlers.onError?.(`malformed event frame: ${String(error)}`);
      }
    });

    source.addEventListener(SSE_FRAME.status, (event) => {
      try {
        const payload = JSON.parse(event.data) as { status: ConnectionStatus };
        handlers.onStatus(payload.status);
      } catch {
        // A status frame is advisory; a bad one must not break the stream.
      }
    });
  }

  stop(): void {
    this.stopped = true;
    this.source?.close();
    this.source = undefined;
  }

  /**
   * Ask the engine directly whether a provider is connected.
   *
   * Deliberately uses the *global* `fetch` rather than the injectable `fetchImpl`: that
   * one is the command channel, and a probe sharing it would consume a call the caller
   * (and its tests) expect to belong to a command. Best-effort by design — any failure is
   * swallowed, since the stream's bootstrap frame carries the same data.
   */
  private async probeHealth(): Promise<void> {
    const fetchImpl = globalThis.fetch;
    if (!fetchImpl) return;
    try {
      const url = `${this.options.baseUrl.replace(/\/+$/, '')}${ENGINE_ROUTES.health}`;
      const response = await fetchImpl(url);
      if (!response.ok) return;
      const health = (await response.json()) as EngineHealth;
      if (this.stopped || !health.providerStatus) return;
      this.handlers?.onProviderStatus?.(health.providerStatus);
    } catch {
      // The stream is the primary channel; a failed probe is not an error worth showing.
    }
  }

  send(command: Command): void {
    // Recorded synchronously so a caller (and a test) can assert the intent immediately;
    // delivery is best-effort and reports failures through `onError`.
    this.sent.push(command);
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      this.handlers?.onError?.('cannot send command: fetch is unavailable');
      return;
    }
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}${ENGINE_ROUTES.command}`;
    void fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    })
      .then(async (response) => {
        const ack = (await response.json().catch(() => ({ ok: response.ok }))) as CommandAck;
        if (!ack.ok) {
          this.handlers?.onError?.(ack.error ?? `command ${command.type} was rejected`);
          return;
        }
        // Every accepted command answers through the result channel (Iteration 22):
        // query commands carry `data`, intent commands carry nothing — either way the
        // caller's await resolves instead of hanging on an engine that moved on.
        this.handlers?.onCommandResult?.(command.commandId, ack.data);
      })
      .catch((error: unknown) => {
        this.handlers?.onError?.(`command ${command.type} failed to send: ${String(error)}`);
      });
  }
}

function defaultEventSource(url: string): EventSourceLike {
  if (typeof EventSource === 'undefined') {
    throw new Error('EventSource is unavailable in this environment');
  }
  return new EventSource(url) as unknown as EventSourceLike;
}