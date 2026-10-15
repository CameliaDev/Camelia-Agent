/**
 * Heuristics for assistant text that should stay folded by default in chat/task UI.
 * @module
 */

/** Long plain answers freeze the thread if left fully open — fold past this length. */
export const LONG_ASSISTANT_ANSWER_CHARS = 1_200;

export function isNoisyAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  if (/^system:/i.test(trimmed) || /^\[system\]/i.test(trimmed)) return true;
  if (trimmed.length > 480 && /\b(reasoning|thought|analysis|思考|推理)\b/i.test(trimmed)) return true;
  return false;
}

/** Collapse long or noisy assistant bodies (chat answer bubbles + task narration). */
export function shouldCollapseAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isNoisyAssistantText(trimmed)) return true;
  return trimmed.length > LONG_ASSISTANT_ANSWER_CHARS;
}
