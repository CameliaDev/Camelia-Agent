/**
 * Stop clears busy optimistically so the red button yields immediately.
 * @module
 */
import { describe, expect, it } from 'vitest';

import { createUiStore, makeCommand } from '../src/state/store.js';
import { FixtureTransport } from '../src/transport/fixture.js';

describe('chat_cancel optimistic clear', () => {
  it('clears inflight and streaming on chat_cancel before the engine seals', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const store = createUiStore(transport);
    store.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        chat: {
          ...state.snapshot.chat,
          inflight: true,
          turns: [
            {
              id: 'u1',
              role: 'user',
              text: 'hi',
              streaming: false,
              toolCalls: [],
              at: 1,
            },
            {
              id: 'a1',
              role: 'assistant',
              text: 'partial',
              streaming: true,
              toolCalls: [],
              at: 2,
            },
          ],
        },
      },
    }));
    store.getState().dispatch(makeCommand('chat_cancel', { sessionId: 'ses_x' }));
    const chat = store.getState().snapshot.chat;
    expect(chat.inflight).toBe(false);
    expect(chat.turns.some((t) => t.role === 'assistant' && t.streaming)).toBe(false);
    expect(transport.sent.some((c) => c.type === 'chat_cancel')).toBe(true);
  });
});
