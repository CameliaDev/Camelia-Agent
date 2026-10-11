/**
 * Wire contract between the UI and a live engine (whitepaper §6.1).
 *
 * The UI is a projection of the engine's event stream; `camelia serve` is what puts
 * that stream on a socket. Both ends import these constants from the browser-safe
 * `view` surface so the route names, SSE frame names and payload envelopes cannot
 * drift apart. Nothing here is HTTP-specific beyond the names — the transport
 * implementations own the actual `EventSource` / `http.Server` details.
 * @module
 */

import type { Id } from '@camelia/core';
import type { Session } from '@camelia/core';

import type { SessionView } from './snapshot.js';

/** HTTP routes the engine exposes. */
export const ENGINE_ROUTES = {
  /** `GET` — server-sent event stream (bootstrap, then domain events). */
  events: '/events',
  /** `POST` — one `Command` per request body. */
  command: '/command',
  /** `GET` — liveness probe used by the shell before it opens the stream. */
  health: '/health',
} as const;

/** Named SSE frames. The default `message` event is deliberately unused. */
export const SSE_FRAME = {
  /** `BootstrapPayload` — sent once, before any domain event. */
  bootstrap: 'bootstrap',
  /** One `DomainEvent` envelope. */
  domain: 'domain',
  /** `{ status: ConnectionStatus }` — the engine's view of the link. */
  status: 'status',
} as const;

export type SseFrameName = (typeof SSE_FRAME)[keyof typeof SSE_FRAME];

/** `GET /health` response body. */
export interface EngineHealth {
  ok: boolean;
  sessionId?: Id;
  provider?: string;
  model?: string;
  /** Number of clients currently attached to `/events`. */
  clients: number;
}

/** `POST /command` response body. */
export interface CommandAck {
  ok: boolean;
  /** Present when `ok` is false: why the command was rejected. */
  error?: string;
  /**
   * Present for *query* commands (memory panel, Iteration 22): the engine's
   * answer to a read, carried back on the same envelope so the UI never has to
   * invent a second channel. The data is whatever the runtime method returned.
   */
  data?: unknown;
}

/** Project a persisted `Session` into the shape the UI renders. */
export function toSessionView(session: Session): SessionView {
  return {
    id: session.id,
    title: session.title,
    workspace: session.workspace,
    provider: session.provider,
    model: session.model,
  };
}