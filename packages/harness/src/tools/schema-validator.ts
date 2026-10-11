/**
 * Minimal JSON-Schema validator.
 *
 * Whitepaper §5.5: parameter validation must not depend on the model. A weak
 * model emitting a malformed tool call must be caught here, deterministically,
 * before anything touches the filesystem.
 * @module
 */

import type { JsonSchema, JsonValue } from '@camelia/core';

export interface ValidationIssue {
  /** JSON pointer-ish path, e.g. `$.path`. */
  path: string;
  message: string;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === 'integer') return actual === 'number' && Number.isInteger(value as number);
  if (expected === 'number') return actual === 'number';
  return actual === expected;
}

/**
 * Validate `value` against `schema`. Returns every issue found rather than
 * throwing, so the caller can feed them back to the model in one round trip.
 */
export function validateSchema(
  schema: JsonSchema,
  value: unknown,
  path = '$',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((t) => matchesType(value, t))) {
      issues.push({ path, message: `expected ${expected.join(' | ')}, got ${typeOf(value)}` });
      return issues;
    }
  }

  if (schema.enum && !schema.enum.some((candidate) => deepEqual(candidate, value as JsonValue))) {
    issues.push({
      path,
      message: `must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`,
    });
  }

  if (typeOf(value) === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) {
        issues.push({ path: `${path}.${key}`, message: 'is required' });
      }
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined) {
        issues.push(...validateSchema(subSchema, record[key], `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(record)) {
        if (!(key in schema.properties)) {
          issues.push({ path: `${path}.${key}`, message: 'is not an allowed property' });
        }
      }
    }
  }

  if (typeOf(value) === 'array' && schema.items) {
    (value as unknown[]).forEach((item, index) => {
      issues.push(...validateSchema(schema.items!, item, `${path}[${index}]`));
    });
  }

  return issues;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Human-readable one-liner for feeding validation failures back to the model. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join('; ');
}