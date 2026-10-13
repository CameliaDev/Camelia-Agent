/**
 * Memory panel component tests (Iteration 22).
 *
 * The panel is a query surface: every number it shows must be engine data routed
 * through `SseTransport → EngineServer → SqliteSessionStore` in production and
 * through the same command channel in the fixture. These tests render the panel
 * against the *fixture* engine (the offline stand-in that speaks the identical
 * command protocol) and assert the four panel goals: the task scope holds, layers
 * are visible, value scores decompose, interventions leave as commands and re-render
 * from the engine's mutated store, and recall provenance is readable.
 *
 * The **scope** assertion is the load-bearing one: the panel answers "what did *this
 * task* learn?", so a cross-session memory must never appear in it. That distinction
 * is what makes the panel readable, and it is the reason the fixture's global row is
 * asserted *absent* rather than merely unmentioned.
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

/** The cross-session row the panel must never show — it belongs to Settings. */
const GLOBAL_ROW = /Camelia matches recall by token overlap/;

async function renderPanel() {
  // A scene *with* a session: the panel is task-scoped, so `empty` (no session) is the
  // one state where it is correct for the list to be blank. Using it here would assert
  // the wrong thing.
  const transport = new FixtureTransport({ scene: 'running' });
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
  it('shows only what this task learned, with the value decomposition and evidence line', async () => {
    await renderPanel();

    // The panel is titled for its scope, not as a generic memory dump.
    expect(screen.getByText(/^TASK MEMORY$|^本任务记忆$/)).toBeInTheDocument();

    // A session memory is listed with engine data…
    expect(within(list()).getByText(/create-todo-module recipe/)).toBeInTheDocument();

    // …and the cross-session row is NOT, because the list is scoped to this session.
    expect(within(list()).queryByText(GLOBAL_ROW)).not.toBeInTheDocument();

    // Value decomposition: strength = importance × recency × correctness.
    expect(within(list()).getByText('= imp 0.85 × 0.50 × 1.00')).toBeInTheDocument();

    // Evidence line for the validated procedural memory.
    expect(within(list()).getByText(/validated by tsk_fixture_verify \(pass\)/)).toBeInTheDocument();

    // Health chip from the engine's aggregate.
    expect(screen.getByText('noise 8%')).toBeInTheDocument();
  });

  it('filters by layer within the task scope', async () => {
    await renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Proc' }));
    expect(within(list()).getByText(/create-todo-module recipe/)).toBeInTheDocument();
    expect(within(list()).queryByText(/idempotent seed/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Short' }));
    expect(within(list()).getByText(/idempotent seed/)).toBeInTheDocument();
    expect(within(list()).queryByText(/create-todo-module recipe/)).not.toBeInTheDocument();

    // No tab can surface a cross-session row — the scope is applied before the tab is.
    // `long` is unreachable for a session memory (promotion re-scopes it to global), so
    // this tab lands on the honest empty state rather than on the global row.
    await userEvent.click(screen.getByRole('button', { name: 'Long' }));
    expect(screen.queryByTestId('memory-list')).toBeNull();
    expect(screen.queryByText(GLOBAL_ROW)).not.toBeInTheDocument();
    expect(screen.getByText(/No long memories in this task\./)).toBeInTheDocument();

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
    await waitFor(() => expect(within(row).getByText(/known-bad/)).toBeInTheDocument());
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

  it('promote graduates a memory out of the task panel (long-term lives in Settings)', async () => {
    const { transport } = await renderPanel();

    const row = within(list()).getByText(/The todo module needs an idempotent seed/).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'promote' }));

    await waitFor(() => expect(transport.sent.some((command) => command.type === 'promote_memory')).toBe(true));
    // Promotion re-scopes the memory to global, so it leaves the task-scoped list —
    // the row is not "lost", it moved to the surface that owns cross-session memories.
    await waitFor(() =>
      expect(within(list()).queryByText(/The todo module needs an idempotent seed/)).not.toBeInTheDocument(),
    );
  });
});
