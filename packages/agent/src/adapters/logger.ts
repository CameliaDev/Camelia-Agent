/**
 * Logger adapter — wires the core `RedactingLogger` to a sink.
 *
 * Secrets are redacted inside the logger itself, so no call site can leak an API
 * key into the log (whitepaper §3.10).
 * @module
 */

import type { LogLevel, LoggerPort } from '@camelia/core';
import { RedactingLogger } from '@camelia/core';

export interface LoggerOptions {
  level?: LogLevel;
  /** When false, log lines are dropped entirely (used by the CLI's quiet mode). */
  enabled?: boolean;
  /** Destination for a rendered log line. Defaults to stderr. */
  write?: (line: string) => void;
}

/** JSON-lines logger bound to a task/session. */
export function createLogger(options: LoggerOptions = {}): LoggerPort {
  const level = options.level ?? 'info';
  const enabled = options.enabled ?? true;
  const write =
    options.write ??
    ((line: string) => {
      process.stderr.write(line);
    });

  return new RedactingLogger(
    (record) => {
      if (!enabled) return;
      write(`${JSON.stringify(record)}\n`);
    },
    level,
  );
}

/** Logger that discards everything — used in tests and in `--quiet` mode. */
export function silentLogger(): LoggerPort {
  return createLogger({ enabled: false, level: 'error' });
}