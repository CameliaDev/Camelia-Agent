/**
 * ChatReplyProgress — phase helper + green/red presence.
 * @module
 */

import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChatView } from '@camelia/agent/view';

import { App } from '../src/App.js';
import {
  ChatReplyProgress,
  chatReplyProgressPhase,
  isChatReplyInFlight,
} from '../src/components/ChatReplyProgress.js';
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

describe('chatReplyProgressPhase', () => {
  it('is hidden on an empty or finished transcript', () => {
    expect(chatReplyProgressPhase(chat())).toBe('hidden');
    expect(
      chatReplyProgressPhase(
        chat({
          turns: [
            { id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 },
            { id: 'a1', role: 'assistant', text: 'hello', streaming: false, toolCalls: [], at: 2 },
          ],
        }),
      ),
    ).toBe('hidden');
  });

  it('is running while waiting after a user turn or while the assistant streams', () => {
    expect(
      chatReplyProgressPhase(
        chat({
          turns: [{ id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 }],
        }),
      ),
    ).toBe('running');
    expect(
      chatReplyProgressPhase(
        chat({
          turns: [
            { id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 },
            { id: 'a1', role: 'assistant', text: 'hel', streaming: true, toolCalls: [], at: 2 },
          ],
        }),
      ),
    ).toBe('running');
  });

  it('is error when the assistant turn failed or a command rejected after the send', () => {
    expect(
      chatReplyProgressPhase(
        chat({
          turns: [
            { id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 },
            {
              id: 'a1',
              role: 'assistant',
              text: '',
              streaming: false,
              toolCalls: [],
              error: 'quota exceeded',
              at: 2,
            },
          ],
        }),
      ),
    ).toBe('error');
    expect(
      chatReplyProgressPhase(
        chat({
          turns: [{ id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 10 }],
        }),
        { type: 'chat', error: '401', at: 11 },
      ),
    ).toBe('error');
  });

  it('stays hidden while an ask_user picker is open', () => {
    expect(
      chatReplyProgressPhase(
        chat({
          turns: [{ id: 'a1', role: 'assistant', text: 'pick one', streaming: false, toolCalls: [], at: 1 }],
          pendingAsk: { askId: 'ask_1', question: '?', options: ['a', 'b'], at: 2 },
        }),
      ),
    ).toBe('hidden');
  });
});

describe('isChatReplyInFlight', () => {
  it('matches the running phase only', () => {
    expect(isChatReplyInFlight(chat())).toBe(false);
    expect(
      isChatReplyInFlight(
        chat({
          turns: [{ id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 }],
        }),
      ),
    ).toBe(true);
  });
});

describe('ChatReplyProgress', () => {
  it('renders green while in flight, hides on finish, red on error', () => {
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

    let bar = container.querySelector('[data-chat-reply-progress]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('data-phase')).toBe('running');
    expect(bar!.querySelector('[data-progress-line]')!.className).toContain('camelia-reply-bar');
    expect(bar!.querySelector('[data-progress-line]')!.className).not.toContain('camelia-pulse');

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

    act(() => {
      store.setState((state) => ({
        snapshot: {
          ...state.snapshot,
          chat: {
            ...state.snapshot.chat,
            turns: [
              { id: 'u1', role: 'user', text: 'hi', streaming: false, toolCalls: [], at: 1 },
              {
                id: 'a1',
                role: 'assistant',
                text: '',
                streaming: false,
                toolCalls: [],
                error: 'no quota',
                at: 2,
              },
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
    bar = container.querySelector('[data-chat-reply-progress]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('data-phase')).toBe('error');
    expect(bar!.querySelector('[data-progress-line]')!.className).toContain('bg-bad');
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
