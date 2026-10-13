/**
 * ChatReplyProgress — in-flight helper + presence while streaming.
 * @module
 */

import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChatView } from '@camelia/agent/view';

import { App } from '../src/App.js';
import { ChatReplyProgress, isChatReplyInFlight } from '../src/components/ChatReplyProgress.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';

function chat(overrides: Partial<ChatView> = {}): ChatView {
  return {
    turns: [],
    policy: 'readonly-sandbox',
    ...overrides,
  };
}

describe('isChatReplyInFlight', () => {
  it('is false on an empty or finished transcript', () => {
    expect(isChatReplyInFlight(chat())).toBe(false);
    expect(
      isChatReplyInFlight(
        chat({
          turns: [
            { id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 },
            { id: 'a1', role: 'assistant', text: 'hello', streaming: false, toolCalls: [], at: 2 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('is true while waiting after a user turn or while the assistant streams', () => {
    expect(
      isChatReplyInFlight(
        chat({
          turns: [{ id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 }],
        }),
      ),
    ).toBe(true);
    expect(
      isChatReplyInFlight(
        chat({
          turns: [
            { id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 },
            { id: 'a1', role: 'assistant', text: 'hel', streaming: true, toolCalls: [], at: 2 },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('stays hidden while an ask_user picker is open', () => {
    expect(
      isChatReplyInFlight(
        chat({
          turns: [{ id: 'a1', role: 'assistant', text: 'pick one', streaming: false, toolCalls: [], at: 1 }],
          pendingAsk: { askId: 'ask_1', question: '?', options: ['a', 'b'], at: 2 },
        }),
      ),
    ).toBe(false);
  });
});

describe('ChatReplyProgress', () => {
  it('renders the two-dot bar only while a reply is in flight', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const store = createUiStore(transport);
    const { container, rerender } = render(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );

    expect(container.querySelector('[data-chat-reply-progress]')).toBeNull();

    act(() => {
      store.setState((state) => ({
        snapshot: {
          ...state.snapshot,
          chat: {
            ...state.snapshot.chat,
            turns: [
              { id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 },
              { id: 'a1', role: 'assistant', text: '…', streaming: true, toolCalls: [], at: 2 },
            ],
          },
        },
      }));
    });
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );

    const bar = container.querySelector('[data-chat-reply-progress]');
    expect(bar).not.toBeNull();
    expect(bar!.querySelectorAll('[data-progress-dot]')).toHaveLength(2);
    expect(bar!.querySelector('[data-progress-line]')).not.toBeNull();

    act(() => {
      store.setState((state) => ({
        snapshot: {
          ...state.snapshot,
          chat: {
            ...state.snapshot.chat,
            turns: [
              { id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 },
              { id: 'a1', role: 'assistant', text: 'done', streaming: false, toolCalls: [], at: 2 },
            ],
          },
        },
      }));
    });
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );
    expect(container.querySelector('[data-chat-reply-progress]')).toBeNull();
  });

  it('mounts the isolated component without crashing', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const store = createUiStore(transport);
    const { container } = render(
      <UiProvider store={store}>
        <ChatReplyProgress />
      </UiProvider>,
    );
    expect(container.querySelector('[data-chat-reply-progress]')).toBeNull();
  });
});