/**
 * Transport contract for the UI.
 *
 * The UI never talks to `harness` and never touches the database (§2.2). It receives
 * a stream of domain events from the `agent` layer and sends commands back down. The
 * transport is the *only* place that knows whether those events arrive from a fixture
 * (offline demo, tests, screenshots) or from a live engine over SSE.
 * @module
 */

import type { Command, DomainEvent } from '@camelia/core';
import type { ProviderStatus, SessionView } from '@camelia/agent/view';

export type ConnectionStatus = 'connecting' | 'live' | 'finished' | 'offline';

/** Session-level data the agent session API hands the UI once, before the event stream. */
export interface BootstrapPayload {
  session?: SessionView;
  sessions: SessionView[];
  provider?: { activeProvider?: string; activeModel?: string };
  /**
   * Whether the engine resolved a working provider at boot, plus the chain it will walk.
   *
   * Sent on bootstrap because it is a property of *this engine instance*, not a change
   * to observe: the first run's `provider.selected` event only arrives after the user
   * submits a task, so without this the header would have to invent a state (whitepaper
   * §6.1 — the UI shows engine truth and nothing else).
   */
  providerStatus?: ProviderStatus;
  /**
   * The active theme's tokens, already validated by the loader's whitelist.
   *
   * Carried on bootstrap rather than as an event because a theme is a property
   * of *this run*, not a change to observe: it must be applied before the first
   * paint of real content, or the user sees a flash of the default palette.
   */
  theme?: { id: string; label?: string; tokens: Record<string, string> };
}

export interface TransportHandlers {
  onEvent: (event: DomainEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
  onBootstrap: (payload: BootstrapPayload) => void;
  /**
   * The engine's provider-connection state, resolved out of band.
   *
   * The live transport gets this from `GET /health` so the header can be accurate before
   * the first task runs; the fixture never calls it (it already knows its scripted
   * provider). Distinct from the `provider.selected` *event*, which describes the routing
   * decision of a run that has actually started.
   */
  onProviderStatus?: (status: ProviderStatus) => void;
  /**
   * A transport-level failure the user should know about — distinct from a *task*
   * failure, which arrives as a domain event. The fixture never calls it; the live
   * transport does when a command is rejected or the engine is unreachable.
   */
  onError?: (message: string) => void;
  /**
   * A command was rejected by the engine (`CommandAck.ok === false`).
   * Distinct from `onError`: rejected intents (rollback stub, etc.) must not
   * look like a dead transport. Pending `query()` callers are rejected too.
   */
  onCommandRejected?: (commandId: string, type: string, error: string) => void;
  /**
   * Response to a *query* command (memory panel, Iteration 22). The engine answers
   * reads on the same command envelope (`CommandAck.data`); the transport routes
   * the answer back here so the UI can render engine data, never fixture data for
   * the live path.
   */
  onCommandResult?: (commandId: string, data: unknown) => void;
}

export interface Transport {
  readonly kind: 'fixture' | 'sse';
  start(handlers: TransportHandlers): void;
  stop(): void;
  /** Send a user intent downward (`ui → agent`). */
  send(command: Command): void;
  /** Commands this transport actually received — lets tests assert intent dispatch. */
  readonly sent: Command[];
}