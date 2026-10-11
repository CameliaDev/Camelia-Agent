/**
 * Logger implementations.
 * @module
 */

import type { JsonValue } from '../types/common.js';
import type { LogLevel, LoggerPort } from '../ports/logger.js';
import { redact, redactText } from '../ports/logger.js';

export interface LogRecord {
  level: LogLevel;
  message: string;
  meta?: JsonValue;
  bindings: Record<string, JsonValue>;
  ts: number;
}

export type LogSink = (record: LogRecord) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Logger that redacts secrets and forwards to a sink.
 * Default sink writes JSON lines to stderr; tests inject a collector sink.
 */
export class RedactingLogger implements LoggerPort {
  constructor(
    private readonly sink: LogSink,
    private readonly minLevel: LogLevel = 'info',
    private readonly bindings: Record<string, JsonValue> = {},
  ) {}

  private emit(level: LogLevel, message: string, meta?: JsonValue): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    this.sink({
      level,
      message: redactText(message),
      meta: meta === undefined ? undefined : redact(meta),
      bindings: this.bindings,
      ts: Date.now(),
    });
  }

  log(level: LogLevel, message: string, meta?: JsonValue): void {
    this.emit(level, message, meta);
  }

  debug(message: string, meta?: JsonValue): void {
    this.emit('debug', message, meta);
  }

  info(message: string, meta?: JsonValue): void {
    this.emit('info', message, meta);
  }

  warn(message: string, meta?: JsonValue): void {
    this.emit('warn', message, meta);
  }

  error(message: string, meta?: JsonValue): void {
    this.emit('error', message, meta);
  }

  child(bindings: Record<string, JsonValue>): LoggerPort {
    return new RedactingLogger(this.sink, this.minLevel, { ...this.bindings, ...bindings });
  }
}

/** Sink that writes one JSON object per line to a Node writable stream. */
export function streamSink(write: (line: string) => void): LogSink {
  return (record) => {
    write(`${JSON.stringify(record)}\n`);
  };
}

/** Logger that collects records in memory — used by tests and the UI log panel. */
export class CollectingLogger implements LoggerPort {
  readonly records: LogRecord[] = [];

  constructor(private readonly minLevel: LogLevel = 'debug') {}

  private emit(level: LogLevel, message: string, meta?: JsonValue): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    this.records.push({ level, message, meta, bindings: {}, ts: Date.now() });
  }

  log(level: LogLevel, message: string, meta?: JsonValue): void {
    this.emit(level, message, meta);
  }
  debug(message: string, meta?: JsonValue): void {
    this.emit('debug', message, meta);
  }
  info(message: string, meta?: JsonValue): void {
    this.emit('info', message, meta);
  }
  warn(message: string, meta?: JsonValue): void {
    this.emit('warn', message, meta);
  }
  error(message: string, meta?: JsonValue): void {
    this.emit('error', message, meta);
  }
  child(bindings: Record<string, JsonValue>): LoggerPort {
    const sink: LogSink = (record) => {
      this.records.push({ ...record, bindings: { ...bindings, ...record.bindings } });
    };
    return new RedactingLogger(sink, this.minLevel, bindings);
  }
}