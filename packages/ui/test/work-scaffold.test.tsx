/**
 * Work scaffold: plan/goal switch, saved notes, folder drop.
 * The empty plan surface must not claim that no plans exist.
 * @module
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';

function renderEmpty() {
  const transport = new FixtureTransport({ scene: 'empty' });
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
  return { ...view, sent };
}

function composer(container: HTMLElement): HTMLTextAreaElement {
  const el = container.querySelector('[data-composer] textarea');
  if (!el) throw new Error('no composer textarea');
  return el as HTMLTextAreaElement;
}

describe('Work plan / goal scaffold', () => {
  it('switches to plan, saves a note, and does not claim there are no plans', () => {
    const { container, sent } = renderEmpty();
    fireEvent.click(container.querySelector('[data-work-posture-tab="plan"]') as HTMLElement);
    expect(container.querySelector('[data-work-posture="plan"]')).not.toBeNull();
    const empty = container.querySelector('[data-work-plan-empty]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent ?? '').not.toMatch(/no plans|no plan|没有计划|还没有计划/i);
    expect(container.textContent ?? '').not.toMatch(/No plan yet/);

    fireEvent.change(composer(container), { target: { value: 'ship the gate\n约束: stay in docs/' } });
    fireEvent.keyDown(composer(container), { key: 'Enter' });

    const saved = sent.find((command) => command.type === 'save_work_plan');
    expect(saved?.payload).toMatchObject({
      mode: 'plan',
      goal: 'ship the gate',
      constraints: ['stay in docs/'],
    });
    expect(container.querySelector('[data-work-plans]')).not.toBeNull();
    expect(container.textContent).toContain('ship the gate');
    expect(container.querySelector('[data-work-plan-empty]')).toBeNull();
  });

  it('attaches a dropped folder and sends it on chat_message', () => {
    const { container, sent } = renderEmpty();
    const card = container.querySelector('[data-composer]') as HTMLElement;
    const entry = { isDirectory: true, isFile: false, name: 'notes', fullPath: '/workspace/notes' };
    const file = new File([''], 'notes');
    const item = {
      kind: 'file',
      type: '',
      getAsFile: () => file,
      webkitGetAsEntry: () => entry,
    };
    const dataTransfer = {
      types: ['Files'],
      items: [item],
      files: [file],
    };
    fireEvent.dragOver(card, { dataTransfer });
    fireEvent.drop(card, { dataTransfer });
    expect(container.querySelector('[data-composer-folder="notes"]')).not.toBeNull();

    fireEvent.change(composer(container), { target: { value: 'read this' } });
    fireEvent.keyDown(composer(container), { key: 'Enter' });
    const chat = sent.find((command) => command.type === 'chat_message');
    expect(chat?.payload.folders).toEqual([{ name: 'notes', path: '/workspace/notes' }]);
    expect(sent.some((command) => command.type === 'submit_task')).toBe(false);
  });
});
