/**
 * Critical-field diff (ARCH-Camelia-v7 §2.3).
 *
 * `expected` and `actual` share one document shape. Timestamps and random ids
 * are noise: a difference that is only noise must not count as a structured
 * mismatch. This is a strict field compare, not a numeric residual threshold.
 * @module
 */

import type { CriticalDiff } from '@camelia/core';

const NOISE_KEYS = new Set([
  'at',
  'timestamp',
  'timestamps',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
  'traceId',
  'trace_id',
  'requestId',
  'request_id',
  'spanId',
  'span_id',
  'nonce',
  'uuid',
  'random',
  'seed',
]);

export function criticalDiff(expected: unknown, actual: unknown): CriticalDiff {
  const changed: string[] = [];
  const ignored: string[] = [];
  walk(expected, actual, '', changed, ignored);
  changed.sort();
  ignored.sort();
  return { equal: changed.length === 0, changed, ignored };
}

function walk(expected: unknown, actual: unknown, path: string, changed: string[], ignored: string[]): void {
  if (isNoisePath(path)) {
    ignored.push(path);
    return;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      changed.push(path || '$');
      return;
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      walk(expected[index], actual[index], join(path, String(index)), changed, ignored);
    }
    return;
  }
  if (isRecord(expected) || isRecord(actual)) {
    if (!isRecord(expected) || !isRecord(actual)) {
      changed.push(path || '$');
      return;
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      const next = join(path, key);
      if (NOISE_KEYS.has(key)) {
        ignored.push(next);
        continue;
      }
      walk(expected[key], actual[key], next, changed, ignored);
    }
    return;
  }
  if (!samePrimitive(expected, actual)) changed.push(path || '$');
}

function join(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function isNoisePath(path: string): boolean {
  if (!path) return false;
  const key = path.slice(path.lastIndexOf('.') + 1);
  return NOISE_KEYS.has(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function samePrimitive(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'number' && Number.isNaN(left) && Number.isNaN(right)) return true;
  return false;
}
