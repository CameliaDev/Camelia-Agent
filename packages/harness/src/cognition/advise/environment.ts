/**
 * Environment check: OK, FAIL, or UNKNOWN (ARCH-Camelia-v7 §2.1, v8 §2.5).
 *
 * A hanging probe is UNKNOWN after the timeout. Retries stay inside one check.
 * The same errorClass reaching three consecutive UNKNOWN results degrades to
 * FAIL so the UI can stop asking. Logs store a status word, never the thrown
 * text, and drop out of the hot window after seven days.
 * @module
 */

import { HOT_LOG_MS, type AdviseErrorClass, type EnvironmentStatus } from '@camelia/core';

export interface EnvironmentLog {
  readonly at: number;
  readonly errorClass: AdviseErrorClass;
  readonly status: 'OK' | 'FAIL' | 'UNKNOWN';
  readonly attempt: number;
  readonly timedOut: boolean;
  /** Closed vocabulary: ok, fail, timeout, throw. Not the error message. */
  readonly note: 'ok' | 'fail' | 'timeout' | 'throw';
}

export interface EnvironmentCheck {
  readonly status: EnvironmentStatus;
  readonly attempts: number;
  readonly timedOut: boolean;
  readonly degraded: boolean;
  readonly logs: readonly EnvironmentLog[];
}

export class EnvironmentLedger {
  private readonly logs: EnvironmentLog[] = [];
  private readonly streaks = new Map<string, number>();
  archived = 0;

  note(errorClass: AdviseErrorClass, raw: 'OK' | 'FAIL' | 'UNKNOWN', at: number): { effective: EnvironmentStatus; degraded: boolean } {
    this.prune(at);
    const streak = raw === 'UNKNOWN' ? (this.streaks.get(errorClass) ?? 0) + 1 : 0;
    this.streaks.set(errorClass, streak);
    const degraded = raw === 'UNKNOWN' && streak >= 3;
    return { effective: degraded ? 'FAIL' : raw, degraded };
  }

  push(entry: EnvironmentLog): void {
    this.logs.push(entry);
    this.prune(entry.at);
  }

  hotLogs(now: number): readonly EnvironmentLog[] {
    this.prune(now);
    return [...this.logs];
  }

  prune(now: number): void {
    const kept = this.logs.filter((entry) => now - entry.at <= HOT_LOG_MS);
    this.archived += this.logs.length - kept.length;
    this.logs.length = 0;
    this.logs.push(...kept);
  }
}

export interface EnvironmentProbeOptions {
  readonly errorClass: AdviseErrorClass;
  readonly probe: () => Promise<'OK' | 'FAIL'>;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly now: () => number;
  readonly ledger: EnvironmentLedger;
  readonly sleep?: (ms: number) => Promise<void>;
}

export async function checkEnvironment(options: EnvironmentProbeOptions): Promise<EnvironmentCheck> {
  const attempts = Math.max(1, options.maxRetries);
  const sleep = options.sleep ?? defaultSleep;
  let timedOut = false;
  let raw: 'OK' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN';
  let used = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    used = attempt;
    const at = options.now();
    try {
      const value = await withTimeout(options.probe(), options.timeoutMs);
      raw = value === 'FAIL' ? 'FAIL' : 'OK';
      options.ledger.push({ at, errorClass: options.errorClass, status: raw, attempt, timedOut: false, note: raw === 'OK' ? 'ok' : 'fail' });
      break;
    } catch (error) {
      const timeout = isTimeout(error);
      timedOut = timedOut || timeout;
      raw = 'UNKNOWN';
      options.ledger.push({
        at,
        errorClass: options.errorClass,
        status: 'UNKNOWN',
        attempt,
        timedOut: timeout,
        note: timeout ? 'timeout' : 'throw',
      });
      if (attempt < attempts) await sleep(Math.min(50, 10 * attempt));
    }
  }

  const noted = options.ledger.note(options.errorClass, raw, options.now());
  return {
    status: noted.effective,
    attempts: used,
    timedOut,
    degraded: noted.degraded,
    logs: options.ledger.hotLogs(options.now()),
  };
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTimeout(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'timeout' in error && (error as { timeout?: unknown }).timeout === true);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
