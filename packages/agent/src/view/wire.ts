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
  /** `ProviderStatus` — pushed after a live model/provider switch. */
  provider: 'provider',
} as const;

export type SseFrameName = (typeof SSE_FRAME)[keyof typeof SSE_FRAME];

/**
 * Whether the engine actually resolved a working provider when it booted.
 *
 * `connected` is the one fact the UI cannot derive from the event stream: events only
 * describe the *current session's* routing, so a freshly launched engine with sessions
 * but no run yet would otherwise have nothing to show (whitepaper §6.1 — the UI shows
 * engine truth, never a guess).
 */
export interface ProviderStatus {
  /** `connected` when the runtime resolved an active provider; `unavailable` otherwise. */
  state: 'connected' | 'unavailable';
  /** Id of the provider that will be used for the next run. */
  id?: string;
  /** Model the router picked for the next run. */
  model?: string;
  /** Models the active provider advertises — what the composer may switch between in place. */
  models?: string[];
  /** Rich per-model caps (vision, context window) for the picker. Same order as `models`. */
  modelDetails?: ProviderModelDetail[];
  /** Ids of every provider along the configured fallback chain, in order. */
  chain: string[];
}

/** Compact model row the UI can render without another round-trip. */
export interface ProviderModelDetail {
  id: string;
  label: string;
  contextWindow: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsJson: boolean;
  /**
   * Where each flag came from. `context: "default"` is not a real window.
   * Older engines omit this object.
   */
  capabilitySource?: {
    vision: string;
    context: string;
    tools: string;
  };
}

/** `GET /health` response body. */
export interface EngineHealth {
  ok: boolean;
  sessionId?: Id;
  provider?: string;
  model?: string;
  /** Rich provider state — supersedes the bare `provider` field for UI consumption. */
  providerStatus?: ProviderStatus;
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
    kind: session.kind ?? 'work',
  };
}

/** The chain entry shape `CameliaRuntime.providerChain()` returns. */
export interface ProviderChainEntry {
  id: string;
  label: string;
  model: string;
  /** Every model this provider advertises — the set the UI may switch between in place. */
  models?: string[];
  modelDetails?: ProviderModelDetail[];
  active: boolean;
}

/**
 * Resolve the engine's provider status from its own runtime view — the single place the
 * "is a provider connected?" question is answered, so `/health`, the SSE bootstrap frame
 * and any future consumer cannot disagree.
 */
export function toProviderStatus(chain: ProviderChainEntry[], model?: string): ProviderStatus {
  const active = chain.find((entry) => entry.active);
  return {
    state: active ? 'connected' : 'unavailable',
    ...(active ? { id: active.id } : {}),
    ...(active ? { model: model ?? active.model } : {}),
    // The switchable set travels with the status so the composer can offer it without a
    // second round-trip. Only the active provider's models: switching model must not
    // silently switch vendor, and a provider with no advertised list gets no dropdown.
    ...(active?.models?.length ? { models: active.models } : {}),
    ...(active?.modelDetails?.length ? { modelDetails: active.modelDetails } : {}),
    chain: chain.map((entry) => entry.id),
  };
}