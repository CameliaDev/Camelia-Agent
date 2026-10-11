/**
 * Logger port. Structured, redaction-aware logging.
 *
 * Secrets must never reach the log (whitepaper §3.10): the logger is the last
 * place we can enforce that before bytes hit disk.
 * @module
 */

import type { JsonValue } from '../types/common.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerPort {
  log(level: LogLevel, message: string, meta?: JsonValue): void;
  debug(message: string, meta?: JsonValue): void;
  info(message: string, meta?: JsonValue): void;
  warn(message: string, meta?: JsonValue): void;
  error(message: string, meta?: JsonValue): void;
  /** Derive a logger with extra bound context (e.g. `{ taskId }`). */
  child(bindings: Record<string, JsonValue>): LoggerPort;
}

const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password|bearer)/i;

/** Recursively redact secret-looking fields from a structured value. */
export function redact(value: JsonValue, depth = 0): JsonValue {
  if (depth > 6) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

/** Redact obvious secret patterns inside free text (e.g. `sk-...`). */
export function redactText(text: string): string {
  return text
    .replace(/\b(sk|pk|ghp|gho|xox[baprs])-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [redacted]');
}