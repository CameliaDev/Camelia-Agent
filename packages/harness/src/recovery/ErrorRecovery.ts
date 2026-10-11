/**
 * Error recovery (whitepaper §3.11, §5.3).
 *
 * Classification and strategy selection are *pure* and deterministic: no model,
 * no randomness, no hidden state. That is what makes a retry policy auditable and
 * lets the recovery decision be driven by the task state machine rather than a
 * blind loop.
 * @module
 */

import { ModelCallError } from '../model/ModelGateway.js';

export type ErrorClass = 'transient' | 'permanent' | 'model' | 'tool' | 'policy';

export type RecoveryKind =
  | 'retry'
  | 'switch-provider'
  | 'replan'
  | 'rollback'
  | 'ask-human'
  | 'abort'
  | 'degrade-readonly';

export interface RecoveryStrategy {
  kind: RecoveryKind;
  /** Attempt number this strategy is for (1-based). */
  attempt: number;
  /** Delay before acting, for `retry`. */
  backoffMs?: number;
  /** Human-readable rationale, surfaced in the UI and the iteration log. */
  note: string;
}

const TRANSIENT_PATTERNS = [
  'etimedout',
  'econnreset',
  'enotfound',
  'eai_again',
  'timeout',
  'timed out',
  'rate limit',
  '429',
  '503',
  'temporarily unavailable',
  'socket hang up',
];

const POLICY_PATTERNS = [
  'denied',
  'deny list',
  'escapes workspace',
  'not permitted',
  'requires approval',
  'policy',
];

const TOOL_PATTERNS = [
  'enoent',
  'not found',
  'no such file',
  'exited',
  'command failed',
  'oldtext not found',
  'ambiguous',
  'invalid arguments',
];

export class ErrorRecovery {
  constructor(private readonly maxRetries = 3) {}

  /** Map any thrown value onto one of five classes. */
  classify(error: unknown): ErrorClass {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

    if (error instanceof ModelCallError) {
      return error.retryable && this.matches(message, TRANSIENT_PATTERNS) ? 'transient' : 'model';
    }
    if (this.matches(message, POLICY_PATTERNS)) return 'policy';
    if (this.matches(message, TRANSIENT_PATTERNS)) return 'transient';
    if (this.matches(message, TOOL_PATTERNS)) return 'tool';
    return 'permanent';
  }

  /**
   * Choose the next action for a class and attempt number.
   *
   * The escalation ladder follows the matrix in §3.11: try the cheap local fix
   * first, then escalate to a structural fix, then hand back to the human.
   */
  strategy(errorClass: ErrorClass, attempt: number): RecoveryStrategy {
    const canRetry = attempt < this.maxRetries;
    switch (errorClass) {
      case 'transient':
        if (canRetry) {
          return { kind: 'retry', attempt, backoffMs: backoff(attempt), note: 'transient failure — exponential backoff' };
        }
        return { kind: 'switch-provider', attempt, note: 'transient failure persisted — switch provider' };
      case 'model':
        if (canRetry) {
          return { kind: 'retry', attempt, backoffMs: backoff(attempt), note: 'malformed model output — re-prompt with stricter format' };
        }
        return { kind: 'switch-provider', attempt, note: 'model repeatedly malformed — escalate to a stronger model' };
      case 'tool':
        if (canRetry) {
          return { kind: 'retry', attempt, backoffMs: 0, note: 'tool failed — retry with corrected arguments' };
        }
        return { kind: 'rollback', attempt, note: 'tool unrecoverable — roll the step back' };
      case 'policy':
        if (attempt < 2) {
          return { kind: 'ask-human', attempt, note: 'action blocked by policy — request human approval' };
        }
        return { kind: 'abort', attempt, note: 'policy blocks the only viable path — abort with a report' };
      case 'permanent':
        if (attempt < 2) {
          return { kind: 'rollback', attempt, note: 'unrecoverable error — roll back the step' };
        }
        return { kind: 'replan', attempt, note: 'unrecoverable twice — replan the remaining work' };
    }
  }

  /**
   * The ladder as a whole, for observability and for the UI's "what will happen
   * next" panel. `maxRetries` bounds the retry/switch steps; the structural steps
   * (rollback/replan/abort) terminate.
   */
  ladder(errorClass: ErrorClass): RecoveryStrategy[] {
    const ladder: RecoveryStrategy[] = [];
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      ladder.push(this.strategy(errorClass, attempt));
    }
    return ladder;
  }

  private matches(message: string, patterns: string[]): boolean {
    return patterns.some((p) => message.includes(p));
  }
}

/** Exponential backoff capped at 8s. */
export function backoff(attempt: number, base = 400, cap = 8_000): number {
  return Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
}

export interface RetryOptions {
  maxRetries: number;
  sleep: (ms: number) => Promise<void>;
  /** Called before each retry with the chosen strategy. */
  onRetry?: (strategy: RecoveryStrategy, error: unknown) => void;
}

export interface RetryOutcome<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  attempts: number;
  /** True when the last error was classified transient. */
  lastClass?: ErrorClass;
}

/**
 * Run `operation`, retrying only transient failures. Non-transient errors are
 * returned immediately so the caller can escalate structurally (whitepaper §5.3).
 */
export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  recovery: ErrorRecovery,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  let attempt = 0;
  let lastError: unknown;
  let lastClass: ErrorClass | undefined;

  while (attempt < Math.max(1, options.maxRetries)) {
    attempt += 1;
    try {
      return { ok: true, value: await operation(), attempts: attempt, lastClass };
    } catch (error) {
      lastError = error;
      lastClass = recovery.classify(error);
      if (lastClass !== 'transient' || attempt >= options.maxRetries) {
        return { ok: false, error, attempts: attempt, lastClass };
      }
      const strategy = recovery.strategy(lastClass, attempt);
      options.onRetry?.(strategy, error);
      if (strategy.backoffMs) await options.sleep(strategy.backoffMs);
    }
  }
  return { ok: false, error: lastError, attempts: attempt, lastClass };
}