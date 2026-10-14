import { describe, expect, it } from 'vitest';

import { splitThinking } from '../src/lib/thinking.js';

describe('splitThinking', () => {
  it('leaves a plain answer untouched', () => {
    expect(splitThinking('Hi there!')).toEqual({ thinking: '', answer: 'Hi there!', pending: false });
  });

  it('folds a closed think block and keeps the answer outside it', () => {
    const split = splitThinking('<think>weigh the options</think>\n\nThe answer is 4.');
    expect(split.thinking).toBe('weigh the options');
    expect(split.answer).toBe('The answer is 4.');
    expect(split.pending).toBe(false);
  });

  it('treats an unclosed thinking tag as still in flight', () => {
    const split = splitThinking('<thinking>still working');
    expect(split.pending).toBe(true);
    expect(split.thinking).toBe('still working');
    expect(split.answer).toBe('');
  });
});
