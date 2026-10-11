/**
 * Identifier helpers.
 * @module
 */

import { randomUUID, randomBytes } from 'node:crypto';

/** Full uuid v4 identifier. */
export function newId(): string {
  return randomUUID();
}

/** Short, human-readable id — used for trace ids and sub-agent handles. */
export function shortId(length = 8): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Deterministic short hash (FNV-1a 32-bit) — used for action fingerprints. */
export function fingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}