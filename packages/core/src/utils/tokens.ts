/**
 * Token estimation.
 *
 * We deliberately do not ship a tokenizer: providers differ, and an approximate
 * estimate with a safety margin is both faster and dependency-free. The margin is
 * what matters for compaction triggering (whitepaper §4.5).
 * @module
 */

/** Approximate characters-per-token ratio for mixed code + prose. */
const CHARS_PER_TOKEN = 3.6;

/** Estimate tokens for a plain string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimate tokens for a message-ish object. */
export function estimateObjectTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value ?? ''));
}

/** Total tokens across a list of items with a per-item overhead. */
export function estimateTotal(items: readonly unknown[], overheadPerItem = 4): number {
  let total = 0;
  for (const item of items) total += estimateObjectTokens(item) + overheadPerItem;
  return total;
}

/**
 * Apply a safety multiplier so we compact slightly before the real limit.
 */
export function withSafetyMargin(tokens: number, margin = 1.1): number {
  // Round to 6 decimals before ceil: `100 * 1.1` is 110.00000000000001 in binary
  // floating point, which would silently inflate every budget by one token.
  return Math.ceil(Number((tokens * margin).toFixed(6)));
}