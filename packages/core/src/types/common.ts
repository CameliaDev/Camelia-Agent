/**
 * Common primitives shared across the Camelia domain model.
 * @module
 */

/** Opaque identifier (uuid v4 string). */
export type Id = string;

/** Epoch milliseconds. */
export type Timestamp = number;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Minimal JSON-Schema subset used for tool parameter validation. */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonValue[];
  default?: JsonValue;
  additionalProperties?: boolean | JsonSchema;
}

/** Explicit result type — used instead of throwing across layer boundaries. */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Unwrap a Result, throwing if it is an error. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error instanceof Error ? r.error : new Error(String(r.error));
}