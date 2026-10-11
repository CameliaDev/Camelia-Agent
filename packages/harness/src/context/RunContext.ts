/**
 * Run context — the dependency container handed to every harness subsystem.
 *
 * Nothing in the harness reaches for a global: ports and infrastructure arrive
 * here, which is what makes the whole engine testable with fakes (whitepaper §3).
 * @module
 */

import type {
  ClockPort,
  EmitMeta,
  EventBus,
  FsPort,
  Id,
  LLMPort,
  LoggerPort,
  MetricsPort,
  SearchPort,
  SessionStore,
  ShellPort,
  TracerPort,
} from '@camelia/core';

import type { HarnessConfig } from '../config.js';

export interface HarnessPorts {
  llm: LLMPort;
  fs: FsPort;
  shell: ShellPort;
  search: SearchPort;
  clock: ClockPort;
  logger: LoggerPort;
}

export interface HarnessInfra {
  bus: EventBus;
  store: SessionStore;
  tracer: TracerPort;
  metrics: MetricsPort;
  logger: LoggerPort;
}

export interface RunContext {
  taskId: Id;
  sessionId: Id;
  /** Absolute workspace root. */
  workspace: string;
  /** Correlates every event, span and log line produced by this run. */
  traceId: string;
  /** Model id used for decision-grade calls (planning, execution). */
  model: string;
  /** Model id used for grunt work (summaries). Falls back to `model`. */
  gruntModel: string;
  ports: HarnessPorts;
  infra: HarnessInfra;
  config: HarnessConfig;
  /**
   * Tool names the active agent preset permits. `undefined` means "no restriction";
   * `['*']` is equivalent. Enforced twice — the model only *sees* allowed schemas,
   * and a call to anything else is refused before it can have an effect (§8.3).
   */
  allowedTools?: string[];
  /**
   * Persona directives from the active preset, appended to the planner and executor
   * system prompts. Empty when no preset is active.
   */
  presetDirectives?: string;
  /** Cancellation for the whole run (user abort / shutdown). */
  signal: AbortSignal;
}

/** Emit helper bound to a run — keeps `traceId`/`taskId` out of every call site. */
export function runMeta(ctx: RunContext): EmitMeta {
  return { traceId: ctx.traceId, sessionId: ctx.sessionId, taskId: ctx.taskId };
}