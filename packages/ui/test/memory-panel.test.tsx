/**
 * Memory panel component tests (Iteration 22).
 *
 * The panel is a query surface: every number it shows must be engine data routed
 * through `SseTransport → EngineServer → SqliteSessionStore` in production and
 * through the same command channel in the fixture. These tests render the panel
 * against the *fixture* engine (the offline stand-in that speaks the identical
 * command protocol) and assert the four panel goals: four layers are visible,
 * value scores decompose, interventions leave as commands and re-render from the
 * engine's mutated store, and recall provenance is readable.
 * @module
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import { MemoryPanel } from '../src/components/MemoryPanel.js';

/** The memory-list <ul> is the authoritative row surface (the due queue may echo content). */
function list(): HTMLElement {
  return screen.getByTestId('memory-list');
}

function dueQueue(): HTMLElement {
  return screen.getByTestId('due-queue');
}

function forgetLog(): HTMLElement {
  return screen.getByTestId('forget-log');
}

async function renderPanel() {
  const transport = new FixtureTransport({ scene: 'empty' });
  const store = createUiStore(transport);
  render(
    <UiProvider store={store}>
      <MemoryPanel />
    </UiProvider>,
  );
  await waitFor(() => expect(store.getState().memory.items.length).toBeGreaterThan(0));
  return { store, transport };
}

describe('MemoryPanel — visible (Iteration 22)', () => {
  it('shows the four layers, the value decomposition and the evidence line', async () => {
    await renderPanel();

    // The long-term fact is listed with engine data.
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(within(list()).getByText(/Camelia matches recall by token overlap/)).toBeInTheDocument();

    // Value decomposition: strength = importance × recency × correctness.
    expect(within(list()).getByText('= imp 0.80 × 0.50 × 0.90')).toBeInTheDocument();

    // Evidence line for the validated procedural memory.
    expect(within(list()).getByText(/validated by tsk_fixture_verify \(pass\)/)).toBeInTheDocument();

    // Health chip from the engine's aggregate.
    expect(screen.getByText('noise 8%')).toBeInTheDocument();
  });

  it('filters by layer and every tab shows only that layer', async () => {
    await renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Proc' }));
    expect(within(list()).queryByText(/Camelia matches recall by token overlap/)).not.toBeInTheDocument();
    expect(within(list()).getByText(/create-todo-module recipe/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Long' }));
    expect(within(list()).getByText(/Camelia matches recall by token overlap/)).toBeInTheDocument();
    expect(within(list()).queryByText(/create-todo-module recipe/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(within(list()).getAllByText(/incorrect/).length).toBeGreaterThan(0);
  });

  it('shows the forget log and the reactivation queue from the engine', async () => {
    await renderPanel();

    // Forget trail: what was forgotten and why.
    expect(screen.getByText('forget log')).toBeInTheDocument();
    expect(within(forgetLog()).getByText('user-correction')).toBeInTheDocument();

    // The one item whose spaced-repetition slot is now due is queued with its strength.
    expect(screen.getByText('due for reactivation')).toBeInTheDocument();
    expect(within(dueQueue()).getByText(/The UI right rail currently holds/)).toBeInTheDocument();
    expect(within(dueQueue()).getByText('0.35')).toBeInTheDocument();
  });
});

describe('MemoryPanel — usable (Iteration 22)', () => {
  it('mark incorrect leaves as a command and re-renders the store state as known-bad', async () => {
    const { transport } = await renderPanel();

    const row = within(list()).getByText(/The todo module needs an idempotent seed/).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'incorrect' }));

    await waitFor(() => {
      const sent = transport.sent.find((command) => command.type === 'mark_memory_incorrect');
      expect(sent).toBeTruthy();
      expect((sent?.payload as { memoryId: string }).memoryId).toBe('mem_fixture_short_1');
    });
    await waitFor(() => expect(within(row).getByText('known-bad')).toBeInTheDocument());
  });

  it('forget removes the item from the list and lands in the forget log', async () => {
    const { transport } = await renderPanel();

    const row = within(list()).getByText(/The todo module needs an idempotent seed/).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'forget' }));

    await waitFor(() => expect(transport.sent.some((command) => command.type === 'forget_memory')).toBe(true));
    await waitFor(() => expect(within(list()).queryByText(/The todo module needs an idempotent seed/)).not.toBeInTheDocument());
    // …and the audit trail now holds it with the manual reason.
    expect(within(forgetLog()).getByText(/The todo module needs an idempotent seed/)).toBeInTheDocument();
  });

  it('promote moves a short memory to the long tab', async () => {
    const { transport } = await renderPanel();

    const row = within(list()).getByText(/The todo module needs an idempotent seed/).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'promote' }));

    await waitFor(() => expect(transport.sent.some((command) => command.type === 'promote_memory')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Long' }));
    await waitFor(() => expect(within(list()).getByText(/The todo module needs an idempotent seed/)).toBeInTheDocument());
  });
});
