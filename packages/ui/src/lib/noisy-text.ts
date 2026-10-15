/**
 * Heuristics for assistant text that should stay folded by default in chat/task UI.
 * @module
 */

export function isNoisyAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  if (/^system:/i.test(trimmed) || /^\[system\]/i.test(trimmed)) return true;
  if (trimmed.length > 480 && /\b(reasoning|thought|analysis|思考|推理)\b/i.test(trimmed)) return true;
  return false;
}
