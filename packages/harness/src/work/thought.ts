/**
 * The thought a sub-AI must produce before the work-token gate will issue a token.
 * @module
 */

import { extractJsonObject } from '../planning/json.js';
import type { WorkThought } from './WorkTokenGate.js';

export const SUB_AI_THINK_SYSTEM = [
  'You are a Camelia sub-AI. Think before you act. You have no tools on this turn.',
  'Reply with JSON only:',
  '{"goals":["one sentence"],"constraints":["bounds"],"plan":["short step"]}',
  'goals and plan must each contain at least one non-empty string.',
  'constraints may be an empty array when the assignment names none.',
].join('\n');

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

/** Parse a sub-AI thought. Missing goal or plan yields undefined so the gate can refuse. */
export function parseWorkThought(text: string): WorkThought | undefined {
  const parsed = extractJsonObject<{ goals?: unknown; constraints?: unknown; plan?: unknown }>(text);
  if (!parsed) return undefined;
  const goals = asStrings(parsed.goals);
  const plan = asStrings(parsed.plan);
  if (goals.length === 0 || plan.length === 0) return undefined;
  return { goals, constraints: asStrings(parsed.constraints), plan };
}
