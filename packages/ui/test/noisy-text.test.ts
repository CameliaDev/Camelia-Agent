import { describe, expect, it } from 'vitest';

import {
  isNoisyAssistantText,
  LONG_ASSISTANT_ANSWER_CHARS,
  shouldCollapseAssistantText,
} from '../src/lib/noisy-text.js';

describe('shouldCollapseAssistantText', () => {
  it('folds noisy JSON / system prefixes', () => {
    expect(shouldCollapseAssistantText('{ "a": 1 }')).toBe(true);
    expect(shouldCollapseAssistantText('system: hello')).toBe(true);
    expect(isNoisyAssistantText('short ok')).toBe(false);
  });

  it('folds long plain answers that would freeze the chat thread', () => {
    const long = 'x'.repeat(LONG_ASSISTANT_ANSWER_CHARS + 10);
    expect(shouldCollapseAssistantText(long)).toBe(true);
    expect(shouldCollapseAssistantText('short reply')).toBe(false);
  });
});
