/**
 * Effort is a prompt hint carried on `chat_message` / `submit_task`.
 *
 * It does not switch provider or model. Callers that omit it leave the prompt
 * unchanged, so older clients keep the previous behaviour.
 * @module
 */

import type { ClarifiedIntent, EffortLevel } from '@camelia/core';

export function effortInstruction(level: EffortLevel): string {
  const depth =
    level === 'max'
      ? 'Be thorough: check edge cases and do not stop at the first plausible answer.'
      : level === 'low'
        ? 'Be brief: answer directly and skip optional exploration.'
        : 'Use normal depth.';
  return `Effort preference: ${level}. ${depth} This does not switch the model.`;
}

/** Append the effort line as a constraint. No-op when effort was not sent. */
export function withEffort(intent: ClarifiedIntent, effort: EffortLevel | undefined): ClarifiedIntent {
  if (!effort) return intent;
  const line = effortInstruction(effort);
  if (intent.constraints.includes(line)) return intent;
  return { ...intent, constraints: [...intent.constraints, line] };
}
