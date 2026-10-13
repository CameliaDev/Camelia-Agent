/**
 * 对话 mode regression tests.
 *
 * The original complaint: typing "hello" in chat mode went through the full task
 * pipeline — goal restatement, plan mode, acceptance checks. The contract now is
 * that a chat message is a chat turn: the composer sends `chat_message`, the
 * transcript grows, the task projection stays untouched, and plan mode is never
 * entered automatically. The permission picker chooses the tool posture.
 * @module
 */

import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import type { SceneId } from '../src/transport/scenario.js';

function renderScene(scene: SceneId = 'empty') {
  const transport = new FixtureTransport({ scene });
  const store = createUiStore(transport);
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  const real = transport.send.bind(transport);
  transport.send = (cmd) => {
    sent.push(cmd as unknown as { type: string; payload: Record<string, unknown> });
    real(cmd);
  };
  const view = render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  return { ...view, store, sent };
}

function composer(container: HTMLElement): HTMLTextAreaElement {
  const el = container.querySelector('[data-composer] textarea');
  if (!el) throw new Error('no composer textarea');
  return el as HTMLTextAreaElement;
}

describe('composer chat dispatch', () => {
  it('sends chat_message with the chosen policy — never submit_task', () => {
    const { container, sent, store } = renderScene('empty');
    // The default posture is the restrictive one: read-only, sandboxed.
    expect(store.getState().localPrefs.chatPolicy).toBe('readonly-sandbox');

    act(() => {
      fireEvent.change(composer(container), { target: { value: 'hello' } });
      fireEvent.keyDown(composer(container), { key: 'Enter' });
    });

    expect(sent.map((c) => c.type)).toEqual(['chat_message']);
    expect(sent[0]!.payload.text).toBe('hello');
    expect(sent[0]!.payload.policy).toBe('readonly-sandbox');
    expect(sent.some((c) => c.type === 'submit_task')).toBe(false);
    // The box clears — a chat app, not a form.
    expect(composer(container).value).toBe('');
  });

  it('exposes the permission picker only in chat mode and applies the choice', () => {
    const { container, sent, store } = renderScene('empty');
    // The picker exists here (chat is the default mode) and lists the three postures.
    act(() => {
      fireEvent.click(container.querySelector('[data-composer-policy]') as HTMLElement);
    });
    const listbox = container.querySelector('[data-composer-policies]');
    expect(listbox).not.toBeNull();
    expect(container.querySelectorAll('[data-policy-option]')).toHaveLength(3);

    act(() => {
      fireEvent.click(container.querySelector('[data-policy-option="ask"]') as HTMLElement);
    });
    // The list closes on choice and the posture persists window-locally.
    expect(container.querySelector('[data-composer-policies]')).toBeNull();
    expect(store.getState().localPrefs.chatPolicy).toBe('ask');

    act(() => {
      fireEvent.change(composer(container), { target: { value: '写个文件' } });
      fireEvent.keyDown(composer(container), { key: 'Enter' });
    });
    expect(sent.at(-1)!.payload.policy).toBe('ask');
  });

  it('keeps the task projection and plan mode out of a chat reply', () => {
    const { container, store } = renderScene('empty');
    act(() => {
      fireEvent.change(composer(container), { target: { value: 'hello' } });
      fireEvent.keyDown(composer(container), { key: 'Enter' });
    });

    // The transcript grew with the reply (fixture answers synchronously).
    expect(store.getState().snapshot.chat.turns.length).toBeGreaterThanOrEqual(2);
    // ...and nothing entered the task state machine.
    expect(store.getState().snapshot.task).toBeUndefined();
    expect(container.querySelector('[data-mode-shell="work"]')).not.toBeNull();
    expect(container.querySelector('[data-mode-shell="plan"]')).toBeNull();
    expect(container.querySelector('[data-plan-review]')).toBeNull();
  });
});

describe('chat transcript surface', () => {
  it('renders the scripted scene: bubbles, a tool card and a pending ask picker', () => {
    const { container } = renderScene('chat');
    expect(container.querySelector('[data-chat-transcript]')).not.toBeNull();
    expect(container.querySelector('[data-chat-user]')).not.toBeNull();
    expect(container.querySelector('[data-chat-assistant]')).not.toBeNull();
    expect(container.querySelector('[data-chat-tool]')).not.toBeNull();

    // The pending ask_user renders as a picker with clickable options.
    const ask = container.querySelector('[data-chat-ask]');
    expect(ask).not.toBeNull();
    expect(container.querySelectorAll('[data-chat-ask-option]')).toHaveLength(3);
  });

  it('answers an ask_user through the picker', () => {
    const { container, sent, store } = renderScene('chat');
    const askId = store.getState().snapshot.chat.pendingAsk!.askId;

    act(() => {
      fireEvent.click(container.querySelector('[data-chat-ask-option="1"]') as HTMLElement);
    });

    expect(sent.at(-1)!.type).toBe('chat_answer');
    expect(sent.at(-1)!.payload).toMatchObject({ askId, optionIdx: 1 });
  });
});
