/**
 * Sealed advise error classes.
 *
 * Classification reads the verifier message and the acceptance kind. It does
 * not ask a model. A string outside the enum becomes `unknown`.
 * @module
 */

import { ADVISE_ERROR_CLASSES, type AdviseErrorClass, type EnvironmentStatus } from '@camelia/core';

const SEALED = new Set<string>(ADVISE_ERROR_CLASSES);

export function sealErrorClass(value: string): AdviseErrorClass {
  return SEALED.has(value) ? (value as AdviseErrorClass) : 'unknown';
}

export function hardGateOf(errorClass: AdviseErrorClass): 'test' | 'type' | 'sandbox' | null {
  if (errorClass === 'test' || errorClass === 'type' || errorClass === 'sandbox') return errorClass;
  return null;
}

export function softGateOf(errorClass: AdviseErrorClass): 'lint' | null {
  return errorClass === 'lint' ? 'lint' : null;
}

/**
 * Map a verifier or tool message onto the sealed enum.
 *
 * `acceptanceKind` wins for the hard test gate (`test-pass`), so a passing
 * phrase inside a test failure cannot reclassify it as a contract mismatch.
 */
export function classifyAdviseError(message: string, acceptanceKind?: string): AdviseErrorClass {
  if (acceptanceKind === 'test-pass') return 'test';
  const text = `${acceptanceKind ?? ''} ${message}`.toLowerCase();
  if (/\bsandbox\b/.test(text)) return 'sandbox';
  if (/\blint\b|eslint|prettier/.test(text)) return 'lint';
  if (/\btypecheck\b|\btsc\b|type error|\bts\d{3,5}\b/.test(text)) return 'type';
  if (/\b(vitest|jest|pytest|mocha)\b|npm test|assertion error|expected .* to /.test(text)) return 'test';
  if (/timeout|etimedout|econnreset|eai_again|timed out/.test(text)) return 'env';
  if (/enoent|command not found|spawn |not recognized|missing binary/.test(text)) return 'env';
  if (/denied|requires approval|not permitted|\bpolicy\b/.test(text)) return 'policy';
  if (/malformed|json parse|model output/.test(text)) return 'model';
  if (/command failed|oldtext not found|exited|tool error/.test(text)) return 'tool';
  return 'contract';
}

/** Environment hint from a message. Timeout is UNKNOWN; a missing tool is FAIL. */
export function classifyEnvironment(message: string): EnvironmentStatus {
  const text = message.toLowerCase();
  if (/timeout|etimedout|econnreset|eai_again|timed out/.test(text)) return 'UNKNOWN';
  if (/enoent|command not found|spawn |not recognized|missing binary/.test(text)) return 'FAIL';
  return 'OK';
}
