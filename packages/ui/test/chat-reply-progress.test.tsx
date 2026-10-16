/**
 * Chat status strip — phase helper, centred header, no green rule,
 * and no empty thinking boxes under tool cards.
 * @module
 */

import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChatTurnView, ChatView, ToolCallView } from '@camelia/agent/view';

import { App } from '../src/App.js';
import {
  CHAT_STATUS_PILL_CLASS,
  ChatReplyProgress,
  chatReplyProgressPhase,
  chatRunStatus,
  isChatReplyInFlight,
} from '../src/components/ChatReplyProgress.js';
import { MODE_HEADER_H } from '../src/modes/ModeHeader.js';
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

function turn(partial: Partial<ChatTurnView> & Pick<ChatTurnView, 'id' | 'role' | 'text'>): ChatTurnView {
  return {
    streaming: false,
    toolCalls: [],
    at: 1,
    ...partial,
  };
}

function tool(name: string): ToolCallView {
  return {
    id: `call_${name}`,
    stepId: 'stp',
    taskId: 'tsk',
    name,
    risk: 'read-only',
    reversible: true,
    status: 'ok',
    input: {},
    durationMs: 1,
    approval: 'none',
    at: 1,
  };
}

describe('chatRunStatus', () => {
  it('is idle when nothing has been said, and done after a finished reply', () => {
    expect(chatRunStatus(chat())).toBe('idle');
    expect(
      chatRunStatus(
        chat({
          turns: [
            turn({ id: 'u1', role: 'user', text: 'hi', at: 1 }),
            turn({ id: 'a1', role: 'assistant', text: 'hello', at: 2 }),
          ],
        }),
      ),
    ).toBe('done');
  });

  it('is thinking while waiting or streaming without an answer, and replying once answer text arrives', () => {
    expect(chatRunStatus(chat({ turns: [turn({ id: 'u1', role: 'user', text: 'hi' })] }))).toBe('thinking');
    expect(
      chatRunStatus(
        chat({
          turns: [
            turn({ id: 'u1', role: 'user', text: 'hi', at: 1 }),
            turn({
              id: 'a1',
              role: 'assistant',
              text: '',
              streaming: true,
              toolCalls: [tool('fs.read')],
              at: 2,
            }),
          ],
        }),
      ),
    ).toBe('thinking');
    expect(
      chatRunStatus(
        chat({
          turns: [
            turn({
              id: 'a1',
              role: 'assistant',
              text: '<think>still working',
              streaming: true,
              at: 2,
            }),
          ],
        }),
      ),
    ).toBe('thinking');
    expect(
      chatRunStatus(
        chat({
          turns: [turn({ id: 'a1', role: 'assistant', text: 'hel', streaming: true, at: 2 })],
        }),
      ),
    ).toBe('replying');
  });

  it('is done after tools finish even when an earlier tool round is still marked streaming', () => {
    const finished = chat({
      inflight: false,
      turns: [
        turn({ id: 'u1', role: 'user', text: '改一下 README', at: 1 }),
        turn({
          id: 'a1',
          role: 'assistant',
          text: '',
          streaming: true,
          toolCalls: [tool('fs.read'), tool('fs.write'), tool('test.run')],
          at: 2,
        }),
        turn({ id: 'a2', role: 'assistant', text: '已在 README.md 末尾追加一行。', at: 3 }),
      ],
    });
    expect(chatRunStatus(finished)).toBe('done');
    expect(chatReplyProgressPhase(finished)).toBe('hidden');
    expect(isChatReplyInFlight(finished)).toBe(false);

    // Same shape without the run bit — the latest settled turn still wins.
    const legacy = chat({
      turns: finished.turns,
    });
    expect(chatRunStatus(legacy)).toBe('done');
  });

  it('stays thinking while the run is in flight, and replying once the latest turn has answer text', () => {
    expect(
      chatRunStatus(
        chat({
          inflight: true,
          turns: [
            turn({ id: 'u1', role: 'user', text: 'hi', at: 1 }),
            turn({
              id: 'a1',
              role: 'assistant',
              text: '',
              streaming: true,
              toolCalls: [{ ...tool('fs.read'), status: 'running' }],
              at: 2,
            }),
          ],
        }),
      ),
    ).toBe('thinking');
    expect(
      chatRunStatus(
        chat({
          inflight: true,
          turns: [
            turn({
              id: 'a1',
              role: 'assistant',
              text: '',
              streaming: true,
              toolCalls: [tool('fs.read')],
              at: 2,
            }),
            turn({ id: 'a2', role: 'assistant', text: '已追加', streaming: true, at: 3 }),
          ],
        }),
      ),
    ).toBe('replying');
  });

  it('is done while an ask picker follows a finished reply, and error on a failed turn', () => {
    expect(
      chatRunStatus(
        chat({
          turns: [turn({ id: 'a1', role: 'assistant', text: 'pick one', at: 1 })],
          pendingAsk: { askId: 'ask_1', question: '?', options: ['a', 'b'], at: 2 },
        }),
      ),
    ).toBe('done');
    expect(
      chatRunStatus(
        chat({
          turns: [turn({ id: 'a1', role: 'assistant', text: '', error: 'quota exceeded', at: 2 })],
        }),
      ),
    ).toBe('error');
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

function topbarChatStatus(container: HTMLElement): HTMLElement {
  const top = container.querySelector('.camelia-topbar') as HTMLElement;
  const pill = top.querySelector('[data-topbar-chat-status]') as HTMLElement;
  expect(pill).not.toBeNull();
  return pill;
}

function setChat(store: ReturnType<typeof createUiStore>, turns: ChatTurnView[], pendingAsk?: ChatView['pendingAsk']): void {
  act(() => {
    store.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        chat: {
          ...state.snapshot.chat,
          turns,
          pendingAsk,
        },
      },
    }));
  });
}

describe('ChatReplyProgress', () => {
  it('shows run status in the top bar pill, not a workspace strip, with no progress rule', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const store = createUiStore(transport);
    act(() => store.getState().setLocalPrefs({ language: 'zh' }));
    const { container, rerender } = render(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );

    expect(container.querySelector('[data-chat-reply-progress]')).toBeNull();
    const idle = topbarChatStatus(container);
    expect(idle.getAttribute('data-chat-status')).toBe('idle');
    expect(idle.textContent).toBe('空闲');
    expect(idle.className).toContain(CHAT_STATUS_PILL_CLASS);
    expect(idle.className).toContain('rounded-full');
    expect(idle.getAttribute('role')).toBe('status');
    expect(container.querySelector('[data-progress-line]')).toBeNull();
    expect(container.querySelector('[data-progress-dot]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();

    fireEvent.click(container.querySelector('[data-panel-drawer]') as HTMLElement);
    const panel = container.querySelector('[data-panel-header]') as HTMLElement;
    expect(panel.style.height).toBe(`${MODE_HEADER_H}px`);
    expect(panel.className).toContain('border-b');

    setChat(store, [
      turn({ id: 'u1', role: 'user', text: 'hi', at: 1 }),
      turn({ id: 'a1', role: 'assistant', text: '…', streaming: true, at: 2 }),
    ]);
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );
    let pill = topbarChatStatus(container);
    expect(pill.getAttribute('data-chat-status')).toBe('replying');
    expect(pill.textContent).toBe('回复中…');
    expect(container.querySelector('[data-chat-running]')).toBeNull();
    expect(container.querySelector('[data-progress-line]')).toBeNull();
    expect(container.querySelector('[data-chat-reply-progress]')).toBeNull();

    setChat(store, [
      turn({ id: 'u1', role: 'user', text: 'hi', at: 1 }),
      turn({ id: 'a1', role: 'assistant', text: 'done', at: 2 }),
    ]);
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );
    pill = topbarChatStatus(container);
    expect(pill.getAttribute('data-chat-status')).toBe('done');
    expect(pill.textContent).toBe('已完成');

    setChat(store, [
      turn({ id: 'u1', role: 'user', text: '给当前仓库加一个小改动', at: 1 }),
      turn({
        id: 'a1',
        role: 'assistant',
        text: '',
        streaming: true,
        toolCalls: [tool('fs.read'), tool('fs.write'), tool('test.run')],
        at: 2,
      }),
      turn({ id: 'a2', role: 'assistant', text: '已在 README.md 末尾追加一行。', at: 3 }),
    ]);
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );
    pill = topbarChatStatus(container);
    expect(pill.getAttribute('data-chat-status')).toBe('done');
    expect(pill.textContent).toBe('已完成');
    expect(container.querySelector('[data-progress-line]')).toBeNull();
    expect(container.querySelectorAll('[data-chat-tool-run]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chat-tool]')).toHaveLength(0);
    fireEvent.click(container.querySelector('[data-chat-tool-run] [data-collapsible-toggle]') as HTMLElement);
    expect(container.querySelectorAll('[data-chat-tool]')).toHaveLength(3);

    setChat(store, [
      turn({ id: 'u1', role: 'user', text: 'hi', at: 1 }),
      turn({ id: 'a1', role: 'assistant', text: '', error: 'no quota', at: 2 }),
    ]);
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );
    pill = topbarChatStatus(container);
    expect(pill.getAttribute('data-chat-status')).toBe('error');
    expect(pill.textContent).toBe('回复失败');
    expect(container.querySelector('[data-progress-line]')).toBeNull();
  });

  it('keeps tool cards and drops empty thinking placeholders', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const store = createUiStore(transport);
    act(() => store.getState().setLocalPrefs({ language: 'zh' }));
    const { container, rerender } = render(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );

    setChat(store, [turn({ id: 'u1', role: 'user', text: '改一下 README', at: 1 })]);
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );
    expect(topbarChatStatus(container).textContent).toBe('思考中…');
    expect(container.querySelector('[data-chat-thinking="pending"]')).toBeNull();
    expect(container.querySelector('[data-chat-running]')).toBeNull();

    setChat(store, [
      turn({ id: 'u1', role: 'user', text: '改一下 README', at: 1 }),
      turn({
        id: 'a1',
        role: 'assistant',
        text: '',
        streaming: true,
        toolCalls: [tool('fs.write')],
        at: 2,
      }),
      turn({
        id: 'a2',
        role: 'assistant',
        text: '',
        streaming: true,
        toolCalls: [tool('test.run')],
        thinking: '   ',
        at: 3,
      }),
    ]);
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );
    expect(container.querySelectorAll('[data-chat-assistant]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chat-tool-run]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chat-tool]')).toHaveLength(0);
    fireEvent.click(container.querySelector('[data-chat-tool-run] [data-collapsible-toggle]') as HTMLElement);
    expect(container.querySelectorAll('[data-chat-tool]')).toHaveLength(2);
    expect(container.querySelector('[data-chat-thinking]')).toBeNull();
    expect(container.querySelector('[data-chat-assistant] .camelia-pulse')).toBeNull();
    expect(topbarChatStatus(container).getAttribute('data-chat-status')).toBe('thinking');

    setChat(store, [
      turn({
        id: 'a1',
        role: 'assistant',
        text: '',
        streaming: true,
        toolCalls: [tool('fs.read')],
        thinking: 'check the header row',
        at: 2,
      }),
      turn({
        id: 'a2',
        role: 'assistant',
        text: '<think>weigh the options</think>',
        streaming: true,
        toolCalls: [tool('search.grep')],
        at: 3,
      }),
    ]);
    rerender(
      <UiProvider store={store}>
        <App />
      </UiProvider>,
    );
        const folds = container.querySelectorAll('[data-chat-thinking]');
    expect(container.querySelectorAll('[data-chat-assistant]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chat-tool-run]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chat-tool]')).toHaveLength(0);
    expect(folds).toHaveLength(1);
    expect(folds[0]!.querySelector('[data-collapsed]')!.getAttribute('data-collapsed')).toBe('true');
    expect(folds[0]!.textContent).not.toContain('check the header row');
    expect(folds[0]!.textContent).not.toContain('weigh the options');
    fireEvent.click(folds[0]!.querySelector('[data-collapsible-toggle]') as HTMLElement);
    expect(folds[0]!.querySelector('[data-collapsed]')!.getAttribute('data-collapsed')).toBe('false');
    expect(folds[0]!.textContent).toContain('check the header row');
    expect(folds[0]!.textContent).toContain('weigh the options');
    expect(topbarChatStatus(container).getAttribute('data-chat-status')).toBe('thinking');
  });

  it('mounts the isolated component on the idle status', () => {
    const transport = new FixtureTransport({ scene: 'empty' });
    const store = createUiStore(transport);
    const { container } = render(
      <UiProvider store={store}>
        <ChatReplyProgress />
      </UiProvider>,
    );
    const bar = container.querySelector('[data-chat-status]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('data-status')).toBe('idle');
    expect(bar!.querySelector('[data-progress-line]')).toBeNull();
  });
});
