/**
 * Split a model reply into reasoning and the answer the user should read.
 *
 * `<think>` / `<thinking>` blocks are the in-band form. An unclosed tag means
 * the model is still reasoning. Text outside the tags is the answer.
 * @module
 */

export interface SplitThinking {
  thinking: string;
  answer: string;
  /** True when a think tag was opened and never closed. */
  pending: boolean;
}

export function splitThinking(text: string): SplitThinking {
  if (!text || !/<think(?:ing)?>/i.test(text)) {
    return { thinking: '', answer: text, pending: false };
  }
  const re = /<think(?:ing)?>([\s\S]*?)(?:<\/think(?:ing)?>|$)/gi;
  let thinking = '';
  let answer = '';
  let pending = false;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    answer += text.slice(last, match.index);
    thinking += match[1] ?? '';
    last = match.index + match[0].length;
    if (!/<\/think(?:ing)?>/i.test(match[0])) pending = true;
  }
  answer += text.slice(last);
  return { thinking: thinking.trim(), answer: answer.trim(), pending };
}
