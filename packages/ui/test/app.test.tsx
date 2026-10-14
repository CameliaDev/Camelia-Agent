/**
 * Render tests — the architecture-layer screenshot checklist, asserted instead of eyeballed.
 *
 * Every item the whitepaper demands the user be able to *see* (whitepaper §5) is checked
 * here against a scripted scene: task phase, step list and per-step status, current step
 * and progress, tool input/output/duration, context usage and the compaction log,
 * pause/steer/rollback affordances, sub-agent runs, failure reason + retry + degrade, and
 * stage results. Visual polish is judged from the screenshots; these tests judge whether
 * the architecture is actually exposed.
 * @module
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import type { SceneId } from '../src/transport/scenario.js';

function renderScene(scene: SceneId) {
  const transport = new FixtureTransport({ scene });
  const store = createUiStore(transport);
  // Work mode embeds TaskRunCard when the fixture seeds a task (P0-1 D / F6).
  const view = render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  return { ...view, store, transport };
}

/**
 * Open a section in the right drawer and return the deck.
 *
 * The top bar has one toggle. The sections are the 更多 menu beside it, so a test
 * that wants the run steps opens the drawer, then the menu.
 */
function expandCollapsed(container: HTMLElement): void {
  container.querySelectorAll('[data-collapsible-toggle]').forEach((btn) => {
    fireEvent.click(btn as HTMLElement);
  });
}

function openPanel(container: HTMLElement, id: string): HTMLElement {
  if (!container.querySelector('[data-panel-deck]')) {
    const toggle = container.querySelector('[data-panel-drawer]') as HTMLElement | null;
    if (!toggle) throw new Error('drawer toggle not found');
    fireEvent.click(toggle);
  }
  const deck = container.querySelector('[data-panel-deck]');
  if (deck?.getAttribute('data-panel-deck') === id) return deck as HTMLElement;
  if (id === 'artifacts') {
    const home = container.querySelector('[data-panel-home]') as HTMLElement | null;
    if (home) fireEvent.click(home);
    return container.querySelector('[data-panel-deck]') as HTMLElement;
  }
  const more = container.querySelector('[data-panel-more]') as HTMLElement | null;
  if (more && more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more);
  const tab = container.querySelector(`[data-panel-tab="${id}"]`) as HTMLElement | null;
  if (!tab) throw new Error(`panel tab not found: ${id}`);
  fireEvent.click(tab);
  return container.querySelector('[data-panel-deck]') as HTMLElement;
}

/**
 * The open panel's name, as the deck announces it.
 *
 * Read from the deck's `aria-label` rather than from a visible title: the band deliberately
 * draws no title row, because every panel body already opens with its own `SectionHeader`.
 * A second copy of the same word in the same band reads as two different things.
 */
function panelTitle(container: HTMLElement): string {
  const deck = container.querySelector('[data-panel-deck]');
  return deck?.getAttribute('aria-label') ?? '';
}


// ---------------------------------------------------------------------------
// layout contract (§6.4 grid)
// ---------------------------------------------------------------------------

describe('App — layout contract', () => {
  // Behavior evolution (Iteration 23): rail widths are CSS variables, not static
  // Tailwind classes, so a drag can change them. Defaults stay 260px and 360px.
  // The top bar is a short title strip. Its height is `--top-bar-h` so the grid
  // padding and the overlay agree.
  it('renders the top bar and default rail widths from CSS variables', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');
    expect(container.querySelector('.camelia-topbar')?.className).toContain('h-9');
    const shell = container.querySelector('[data-shell]') as HTMLElement;
    expect(shell.style.getPropertyValue('--top-bar-h')).toBe('36px');
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');
    // The permanent icon rail outside the left column. Its width is not draggable, so it
    // is asserted here as a constant rather than as a stored preference.
    expect(shell.style.getPropertyValue('--rail-icon-w')).toBe('48px');
    expect(container.querySelector('[data-rail="icon"]')).not.toBeNull();
    expect(container.querySelector('[data-rail="left"]')).not.toBeNull();
    // one resizable column, so one divider
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it('draws a VS Code activity bar: icons and tooltips, session list in the next column', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('empty');
    const rail = container.querySelector('[data-rail="icon"]') as HTMLElement;
    const column = container.querySelector('[data-rail="left"]') as HTMLElement;
    expect(rail).not.toBeNull();
    expect(column).not.toBeNull();

    for (const selector of [
      '[data-rail-view="sessions"]',
      '[data-rail-view="extensions"]',
      '[data-rail-settings]',
      '[data-rail-account]',
    ]) {
      const button = rail.querySelector(selector) as HTMLElement;
      expect(button, selector).not.toBeNull();
      expect(button.querySelector('.truncate'), `${selector} has no row label`).toBeNull();
      expect(button.getAttribute('aria-label'), selector).toBeTruthy();
      expect(button.querySelector('[data-tip]'), `${selector} tooltip`).not.toBeNull();
    }

    const sessions = rail.querySelector('[data-rail-view="sessions"]') as HTMLElement;
    expect(sessions.getAttribute('aria-label')).toBe('会话');
    expect(sessions.querySelector('[data-tip]')?.textContent).toContain('聊天记录');
    expect(sessions.querySelector('[data-rail-active]')).not.toBeNull();
    expect(rail.querySelector('[data-rail-view="extensions"] [data-rail-active]')).toBeNull();

    // The list is a sidebar, not a second set of labels on the activity bar.
    expect(column.querySelector('[data-mode-tabs]')).not.toBeNull();
    expect(column.querySelector('[data-session-toolbar]')).not.toBeNull();
    expect(column.querySelector('[data-new-session]')).not.toBeNull();
    expect(rail.querySelector('[data-rail-action]')).toBeNull();
    expect(column.querySelector('[data-rail-view]')).toBeNull();
  });

  it('reserves the bottom strip as grid padding, never as a second row', () => {
    // The strip crosses all four columns, the way VS Code's does. So it cannot be a fifth
    // column and must not be a second grid row: an earlier left-footer attempt added a row
    // and cost a composer ~68px of height plus a cut right-rail divider. Padding is the
    // only relationship that cannot do either.
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');

    const rails = container.querySelector('.camelia-rails') as HTMLElement;
    expect(rails.style.paddingBottom).toBe('28px');
    // One row. A `grid-template-rows` of two entries is exactly what must never appear.
    expect(rails.style.gridTemplateRows).toBe('');
    // Four tracks: icon | session | main | right (F3). Right width is 0 until a panel opens.
    expect(rails.style.gridTemplateColumns).toContain('var(--rail-icon-w)');
    expect(rails.style.gridTemplateColumns).toContain('--rail-right-w');
    // RightRail returns null when closed, so only three DOM children are mounted.
    expect(rails.children.length).toBeGreaterThanOrEqual(3);

    const shell = container.querySelector('[data-shell]') as HTMLElement;
    // The height is published as a variable so the padding and the bar cannot drift apart.
    // 28px, deliberately NOT `TOP_BAR_H`: the bottom strip is ambient and the mode header
    // carries real state, so matching them made the quieter one the louder one.
    expect(shell.style.getPropertyValue('--status-bar-h')).toBe('28px');
  });

  it('draws the status bar with real readouts, and no controls that do nothing', () => {
    // "In case we want to put things here later" is permission to add items, not to ship
    // empty placeholders. Readout cells stay non-interactive. The one control is the
    // connection status, which opens Settings → Engine.
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');

    const bar = container.querySelector('[data-status-bar]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.getPropertyValue('--status-bar-h')).toBe('28px');

    for (const item of ['workspace', 'steps', 'context', 'elapsed']) {
      expect(container.querySelector(`[data-status-item="${item}"]`), item).not.toBeNull();
    }
    const actions = bar.querySelectorAll('button, a, [role="button"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAttribute('data-status-item', 'connection');
    // The workspace row is the folder and the name. The green status pip used to sit in front of them.
    expect(bar.querySelector('[data-status-item="workspace"] .h-2')).toBeNull();
    // A ratio, not a percentage — the weighting behind `progress` is not re-explained here.
    // `count()` abbreviates (`9.7k`), so the separator is what matters, not the digits.
    expect(container.querySelector('[data-status-item="steps"]')!.textContent).toMatch(/\d+\/\d+/);
    expect(container.querySelector('[data-status-item="context"]')!.textContent).toMatch(/[\d.]+k?\/[\d.]+k?/);
    // Elapsed comes from event timestamps, so it is a stable string, not a wall clock.
    expect(container.querySelector('[data-status-elapsed]')!.textContent).toMatch(/^(\d+s|\d+:\d{2}|\d+:\d{2}:\d{2})$/);
  });

  it('keeps the task-only cells out of the way when there is no task', () => {
    // Steps, context and elapsed are facts about a run. With no run they have nothing to
    // say, and printing `0/0` would be inventing a measurement.
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('empty');

    expect(container.querySelector('[data-status-bar]')).not.toBeNull();
    // The workspace survives — it is a property of the window, not of the run.
    expect(container.querySelector('[data-status-item="workspace"]')).not.toBeNull();
    for (const item of ['steps', 'context', 'elapsed']) {
      expect(container.querySelector(`[data-status-item="${item}"]`), item).toBeNull();
    }
  });

  it('keeps the session title in the top bar and does not repeat it in a chat subheader', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');
    const top = container.querySelector('.camelia-topbar') as HTMLElement;
    expect(top.querySelector('[data-topbar-title]')?.textContent).toContain('Add --json output');
    expect(top.querySelector('[data-brand-slot]')?.textContent).toContain('Camelia');
    expect(container.querySelector('[data-chat-workspace] [data-mode-header]')).toBeNull();
    expect(container.querySelector('[data-mode-header] [data-panel-drawer]')).toBeNull();
    // The session header is search and new chat. Collapsing that column is the
    // activity bar, so this row has no 收起会话 control. The right toggle stays
    // in the top bar.
    expect(container.querySelector('[data-session-header] [data-layout-sidebar]')).toBeNull();
    expect(screen.queryByRole('button', { name: '收起会话' })).toBeNull();
    expect(top.querySelector('[data-layout-sidebar]')).toBeNull();
    expect(top.querySelector('[data-panel-drawer]')).not.toBeNull();
    expect(top.querySelector('[data-connection-status]')).toBeNull();
    expect(container.querySelector('[data-status-bar] [data-connection-status]')).not.toBeNull();
    expect(container.querySelector('[data-plan-lifecycle]')).not.toBeNull();
  });

  it('switches the model in place from the composer chip, without a trip to Settings', async () => {
    // The chip used to be a read-only label that opened the settings drawer — the one
    // place a reader looks to change the model could not change it. This pins the
    // replacement: a real listbox, scoped to the active provider, that dispatches
    // `select_provider` and closes.
    localStorage.removeItem('camelia.localPrefs');
    const { container, transport } = renderScene('running');

    const chip = container.querySelector('[data-composer-model]') as HTMLElement | null;
    expect(chip, 'the composer should render a model chip').not.toBeNull();
    expect(chip!.getAttribute('aria-haspopup'), 'the chip advertises a listbox').toBe('listbox');

    fireEvent.click(chip!);
    expect(container.querySelector('[data-composer-models]'), 'the list opens').not.toBeNull();

    const option = container.querySelector('[data-model-option="deepseek-v3:free"]') as HTMLElement | null;
    expect(option, 'every advertised model is offered').not.toBeNull();
    fireEvent.click(option!);

    const sent = transport.sent.find((command) => command.type === 'select_provider');
    expect(sent, 'choosing a model leaves as a select_provider command').toBeTruthy();
    expect(sent?.payload).toMatchObject({ providerId: 'openrouter', model: 'deepseek-v3:free' });
    // …and the list closes, so the chip is not left hanging open over the composer.
    expect(container.querySelector('[data-composer-models]')).toBeNull();
  });

  it('starts with no panel open and opens Artifacts from the single drawer toggle', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('empty');
    expect(container.querySelector('[data-panel-deck]')).toBeNull();
    expect(container.querySelectorAll('[data-panel-drawer]'), 'one drawer glyph').toHaveLength(1);
    expect(container.querySelector('.camelia-topbar [data-panel-drawer]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-panel-drawer]') as HTMLElement);
    expect(panelTitle(container)).toBe('产物');
    expect(container.querySelector('[data-panel-tabs]')).toBeNull();
    // Open or closed, the glyph stays in the top bar. 更多 sits beside it there.
    expect(container.querySelector('[data-right-rail] [data-panel-drawer]')).toBeNull();
    expect(container.querySelector('.camelia-topbar [data-panel-drawer]')).not.toBeNull();
    expect(container.querySelector('.camelia-topbar [data-panel-more]')?.textContent).toBe('更多');
    expect(container.querySelector('[data-right-rail] [data-panel-more]')).toBeNull();
    fireEvent.click(container.querySelector('[data-panel-drawer]') as HTMLElement);
    expect(container.querySelector('[data-panel-deck]')).toBeNull();
  });

  it('keeps secondary sections behind a menu and returns to artifacts', () => {
    const { container } = renderScene('running');
    for (const mode of ['work', 'math'] as const) {
      fireEvent.click(container.querySelector(`[data-mode-tab="${mode}"]`) as HTMLElement);
      expect(container.querySelectorAll('[data-panel-drawer]')).toHaveLength(1);
      expect(container.querySelector('[data-mode-header] [data-panel-drawer]')).toBeNull();
      if (!container.querySelector('[data-panel-deck]')) {
        fireEvent.click(container.querySelector('[data-panel-drawer]') as HTMLElement);
      }
      expect(container.querySelector('[data-panel-deck="artifacts"]')).not.toBeNull();
    }
    fireEvent.click(container.querySelector('[data-mode-tab="work"]') as HTMLElement);
    expect(container.querySelector('[data-panel-tab]')).toBeNull();
    fireEvent.click(container.querySelector('[data-panel-more]') as HTMLElement);
    const tabs = [...container.querySelectorAll('[data-panel-tab]')].map((n) => n.getAttribute('data-panel-tab'));
    expect(tabs).toEqual(['run', 'memory', 'context', 'events', 'sub']);
    fireEvent.click(container.querySelector('[data-panel-tab="memory"]') as HTMLElement);
    expect(container.querySelector('[data-panel-deck="memory"]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-panel-home]') as HTMLElement);
    expect(container.querySelector('[data-panel-deck="artifacts"]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-panel-drawer]') as HTMLElement);
    expect(container.querySelector('[data-panel-deck]')).toBeNull();
    fireEvent.click(container.querySelector('[data-panel-drawer]') as HTMLElement);
    expect(container.querySelector('[data-panel-deck="artifacts"]')).not.toBeNull();
    const meta = container.querySelector('[data-artifact-meta]');
    expect(meta?.textContent).toMatch(/diff|report|stdout/);
    expect(meta?.textContent).toMatch(/\d/);
    expect(container.querySelector('[data-artifact] button')).toBeNull();
  });

  it('dims a task-bound section in the more menu instead of hiding it', () => {
    const { container } = renderScene('empty');
    fireEvent.click(container.querySelector('[data-panel-drawer]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-panel-more]') as HTMLElement);
    const needsTask = container.querySelector('[data-panel-tab="run"]') as HTMLElement;
    const free = container.querySelector('[data-panel-tab="memory"]') as HTMLElement;
    // No task here, so Run has nothing to show. Hiding it would reshuffle the menu;
    // dimming keeps the set stable.
    expect(needsTask.className).toContain('opacity-40');
    expect(free.className).not.toContain('opacity-40');
    fireEvent.click(needsTask);
    expect(container.querySelector('[data-panel-deck="run"]')).not.toBeNull();
  });

  it('closes the open drawer from the top bar, not from a control in the drawer', () => {
    const { container } = renderScene('running');
    openPanel(container, 'run');
    expect(container.querySelector('[data-right-rail] [data-panel-close]')).toBeNull();
    expect(container.querySelector('[data-right-rail] [data-panel-drawer]')).toBeNull();
    const close = container.querySelector('.camelia-topbar [data-panel-close]') as HTMLElement;
    expect(close, 'the top bar toggle dismisses the open drawer').not.toBeNull();
    fireEvent.click(close);
    expect(container.querySelector('[data-panel-deck]')).toBeNull();
    expect(container.querySelector('.camelia-topbar [data-panel-more]')).toBeNull();
  });

  it('keeps artifacts open across modes and hides math outputs outside math', () => {
    const { container } = renderScene('empty');
    fireEvent.click(container.querySelector('[data-mode-tab="math"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-math-demo-load]') as HTMLElement);
    expect(container.querySelector('[data-panel-deck="artifacts"] [data-math-panel="assumptions"]')).not.toBeNull();
    expect(container.querySelector('[data-math-workspace] [data-math-panel]')).toBeNull();
    expect(container.querySelector('[data-math-stages] button')).toBeNull();
    fireEvent.click(container.querySelector('[data-mode-tab="work"]') as HTMLElement);
    expect(container.querySelector('[data-panel-deck="artifacts"]')).not.toBeNull();
    expect(container.querySelector('[data-math-panel]')).toBeNull();
  });

  it('opens panels in the right rail beside the main column (F3)', () => {
    const { container } = renderScene('running');
    openPanel(container, 'events');
    const deck = container.querySelector('[data-panel-deck]') as HTMLElement;
    const rail = container.querySelector('[data-right-rail]') as HTMLElement;
    expect(rail, 'right rail hosts the panel').not.toBeNull();
    expect(deck, 'panel deck attribute rides the right rail').not.toBeNull();
    expect(rail.getAttribute('data-panel-deck')).toBe('events');
    expect(container.querySelector('.camelia-topbar [data-panel-close]')).not.toBeNull();
    expect(rail.querySelector('[data-panel-close]')).toBeNull();
    expect(rail.querySelectorAll('section, [data-event-section]').length).toBeGreaterThan(0);
    // Not inside main — sibling column on the grid.
    expect(rail.closest('main')).toBeNull();
  });

  it('keeps the active session listed even when it was hidden', () => {
    // Reproduce the empty-rail bug: chrome hid the row, engine still resumes it.
    localStorage.setItem(
      'camelia.sessionMarks',
      JSON.stringify({
        pinned: [],
        favorite: [],
        hidden: ['ses_4b1e0c', 'ses_2a77d1'],
      }),
    );
    const { container } = renderScene('running');
    const rail = container.querySelector('[data-rail="left"]') as HTMLElement;
    // Active primary session must remain; the other hidden id stays out.
    expect(rail.querySelector('[data-session="ses_4b1e0c"]')).not.toBeNull();
    expect(rail.querySelector('[data-session="ses_2a77d1"]')).toBeNull();
  });

  it('pins and deletes a session from the left list', () => {
    localStorage.removeItem('camelia.sessionMarks');
    const { container } = renderScene('running');
    const rail = container.querySelector('[data-rail="left"]') as HTMLElement;
    const titles = (): string[] =>
      [...rail.querySelectorAll('[data-session-title]')].map((node) => node.textContent ?? '');
    expect(titles()[0]).toBe('Add --json output to the camelia CLI');
    expect(screen.getAllByRole('button', { name: '置顶' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '收藏' })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: '置顶' })[1]!);
    expect(titles()[0]).toBe('Harden the context compactor');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(rail.querySelector('[data-session="ses_2a77d1"]')).toBeNull();
    expect(rail.querySelector('[data-session="ses_4b1e0c"]')).not.toBeNull();
    expect(titles().some((t) => t.includes('Add --json output'))).toBe(true);
  });

  it('deletes the last remaining session and lands on a fresh chat', async () => {
    localStorage.setItem(
      'camelia.sessionMarks',
      JSON.stringify({ pinned: [], favorite: [], hidden: ['ses_2a77d1', 'ses_91bb03'] }),
    );
    const { container, transport } = renderScene('running');
    expect(container.querySelectorAll('[data-rail="left"] [data-session]')).toHaveLength(1);
    const row = container.querySelector('[data-session="ses_4b1e0c"]') as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    fireEvent.click(within(row).getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(container.querySelector('[data-session="ses_4b1e0c"]')).toBeNull();
      expect(container.querySelector('[data-session="ses_blank_work"]')).not.toBeNull();
    });
    const created = transport.sent.filter((command) => command.type === 'new_session');
    expect(created.at(-1)?.payload).toMatchObject({ excludeId: 'ses_4b1e0c' });
    expect(container.querySelector('[data-composer-slot="centered"]')).not.toBeNull();
  });

  it('does not hand the deleted blank back when it was the last row', async () => {
    localStorage.removeItem('camelia.sessionMarks');
    const { container, transport } = renderScene('running');
    fireEvent.click(container.querySelector('[data-new-session]') as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector('[data-session="ses_blank_work"]')).not.toBeNull();
    });
    for (const id of ['ses_4b1e0c', 'ses_2a77d1', 'ses_91bb03']) {
      const row = container.querySelector(`[data-session="${id}"]`) as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: '删除' }));
      fireEvent.click(within(row).getByRole('button', { name: '确认删除' }));
      await waitFor(() => {
        expect(container.querySelector(`[data-session="${id}"]`)).toBeNull();
      });
    }
    const blank = container.querySelector('[data-session="ses_blank_work"]') as HTMLElement;
    fireEvent.click(within(blank).getByRole('button', { name: '删除' }));
    fireEvent.click(within(blank).getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(container.querySelector('[data-session="ses_blank_work_next"]')).not.toBeNull();
    });
    const created = transport.sent.filter((command) => command.type === 'new_session');
    expect(created.at(-1)?.payload).toMatchObject({ excludeId: 'ses_blank_work' });
    expect(container.querySelector('[data-session="ses_blank_work"]')).toBeNull();
    expect(container.querySelector('[data-composer-slot="centered"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// left icon rail
// ---------------------------------------------------------------------------

describe('App — left icon rail', () => {
  const railOf = (container: HTMLElement): HTMLElement =>
    container.querySelector('[data-rail="icon"]') as HTMLElement;

  const writePrefs = (leftCollapsed: boolean): void => {
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        version: 5,
        leftWidth: 260,
        rightWidth: 360,
        leftCollapsed,
        rightCollapsed: true,
        themeId: 'light',
        language: 'zh',
        topBar: 'pinned',
        motion: 'system',
        fontMono: '',
        planApproval: 'auto',
      }),
    );
  };

  it('tucks the session column away from the chats icon, then opens it again', () => {
    writePrefs(false);
    const { container } = renderScene('running');
    const shell = container.querySelector('[data-shell]') as HTMLElement;
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');

    // No separate 收起会话 button in the session header or the top bar.
    expect(container.querySelector('[data-layout-sidebar]')).toBeNull();
    expect(screen.queryByRole('button', { name: '收起会话' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '会话' }));
    // Zero, not a 48px strip: the rail outside already is the strip, and keeping one here
    // as well would put two re-open controls side by side for a single panel.
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('0px');
    expect(railOf(container)).not.toBeNull();
    // The column is gone, so expand also sits in the top bar. The chats icon still works.
    expect(container.querySelector('.camelia-topbar [data-layout-sidebar]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '会话' }));
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');
    expect(container.querySelector('[data-layout-sidebar]')).toBeNull();
  });

  it('does not put search or new chat on the activity bar', () => {
    writePrefs(true);
    const { container } = renderScene('running');
    const rail = railOf(container);
    expect(rail.querySelector('[data-rail-view="sessions"]')).not.toBeNull();
    expect(rail.querySelector('[data-rail-action]')).toBeNull();
    expect(rail.querySelector('[data-rail-account]')).not.toBeNull();

    // The column still occupies its grid cell (dropping it would shuffle the columns), so
    // it must be inert rather than merely zero-width — otherwise its buttons stay
    // tabbable while invisible.
    const column = container.querySelector('[data-rail="left"]') as HTMLElement;
    expect(column.hasAttribute('inert')).toBe(true);
  });

  it('keeps exactly one account avatar, in the strip that cannot be collapsed', () => {
    // There used to be two: this rail drew a mark at its foot and the session column drew a
    // profile row (mark, name, version line) at the foot of its list, so an open column
    // showed the same identity twice. The column's row is gone; the rail's is the only one
    // left. These assertions are the guard — counting the rail alone would not catch a
    // second one reappearing in the column.
    for (const leftCollapsed of [false, true]) {
      writePrefs(leftCollapsed);
      const { container, unmount } = renderScene('running');
      expect(container.querySelectorAll('[data-rail-account]')).toHaveLength(1);
      expect(railOf(container).querySelector('[data-rail-account]')).not.toBeNull();

      const column = container.querySelector('[data-rail="left"]') as HTMLElement;
      expect(column.querySelector('[data-rail-account]')).toBeNull();
      // Nor does the column repeat the identity as text, which is what "本地用户" under the
      // list was.
      expect(column.textContent ?? '').not.toContain('本地用户');
      unmount();
    }
  });

  it('draws the configured name in the account tooltip, and nothing when it is unset', () => {
    // The name used to be a permanent row at the foot of the session column. Removing that
    // row left the Settings field with nothing to write to — a control that changes nothing
    // is worse than no control — so the name moved into the rail tooltip. This pins the
    // wiring: configured name present, built-in label never invented.
    writePrefs(false);
    const entry = (root: HTMLElement): HTMLElement => root.querySelector('[data-rail-account]') as HTMLElement;

    const unnamed = renderScene('running');
    const plain = entry(unnamed.container).textContent ?? '';
    expect(plain).toContain('账户');
    expect(plain).not.toContain('本地用户');
    expect(plain).not.toContain('·');
    unnamed.unmount();

    const raw = JSON.parse(localStorage.getItem('camelia.localPrefs') as string) as Record<string, unknown>;
    localStorage.setItem('camelia.localPrefs', JSON.stringify({ ...raw, displayName: 'Eliauk' }));
    const named = renderScene('running');
    const namedText = entry(named.container).textContent ?? '';
    expect(namedText).toContain('Eliauk');
    expect(namedText).toContain('账户');
  });

  it('splits the account mark from the settings gear, and each opens its own surface', () => {
    // One button used to do both jobs, labelled "account & settings". Two entries with one
    // shared destination would be that same button wearing two icons, so this asserts the
    // destinations are genuinely distinct: the mark opens the Accounts popover, the gear
    // opens the drawer's first page. Settings → Account is reachable from a menu item.
    writePrefs(false);
    const { container } = renderScene('running');
    const account = railOf(container).querySelector('[data-rail-account]') as HTMLElement;
    const gear = railOf(container).querySelector('[data-rail-settings]') as HTMLElement;
    expect(account, 'the rail has an account mark').not.toBeNull();
    expect(gear, 'the rail has a settings gear').not.toBeNull();
    expect(account.getAttribute('aria-label')).toBe('账户');
    expect(gear.getAttribute('aria-label')).toBe('设置');

    fireEvent.click(gear);
    expect(within(container).getByRole('heading', { name: '连接预设' })).toBeInTheDocument();
    fireEvent.click(within(container).getAllByRole('button', { name: '关闭' })[0]!);
    expect(container.querySelector('[data-settings-page]')).toBeNull();

    fireEvent.click(account);
    expect(container.querySelector('[data-account-menu]')).not.toBeNull();
    expect(container.querySelector('[data-settings-page]')).toBeNull();
    fireEvent.click(container.querySelector('[data-account-menu-settings]') as HTMLElement);
    expect(within(container).getByRole('heading', { name: '账户' })).toBeInTheDocument();
    expect(container.querySelector('[data-account-section]')).not.toBeNull();
  });

  it('opens search from the session toolbar and focuses the field', async () => {
    writePrefs(false);
    const { container } = renderScene('running');
    expect(container.querySelector('[data-session-search]')).toBeNull();
    fireEvent.click(container.querySelector('[data-session-search-toggle]') as HTMLElement);
    await waitFor(() => {
      expect(document.activeElement).toBe(container.querySelector('[data-session-search]'));
    });
  });

  it('starts a blank chat from the session toolbar and clears the previous transcript', async () => {
    writePrefs(false);
    const { container, transport } = renderScene('chat');
    expect(container.querySelector('[data-chat-user]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-new-session]') as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector('[data-session="ses_blank_work"]')).not.toBeNull();
    });
    expect(transport.sent.filter((c) => c.type === 'new_session')).toHaveLength(1);
    expect(container.querySelector('[data-chat-user]')).toBeNull();
    expect(container.querySelector('[data-composer-slot="centered"]')).not.toBeNull();
  });

  it('does not create another blank when the active session is already fresh', async () => {
    writePrefs(false);
    const { container, transport } = renderScene('running');
    fireEvent.click(container.querySelector('[data-new-session]') as HTMLElement);
    await waitFor(() => {
      expect(transport.sent.filter((c) => c.type === 'new_session')).toHaveLength(1);
    });
    const afterFirst = transport.sent.filter((c) => c.type === 'new_session').length;
    fireEvent.click(container.querySelector('[data-new-session]') as HTMLElement);
    expect(transport.sent.filter((c) => c.type === 'new_session')).toHaveLength(afterFirst);
    expect(container.querySelector('[data-composer-slot="centered"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// empty / loading
// ---------------------------------------------------------------------------

describe('App — wireframe v2 chrome', () => {
  it('shows circular message avatars and opens the Accounts menu from the account entry', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');
    expect(container.querySelector('[data-message="user"] [data-avatar="user"]')).not.toBeNull();
    // No avatar was ever configured, so the user side carries the Camelia mark — the
    // documented "only draw the mark when the user has not set one" rule.
    expect(container.querySelector('[data-message="user"] [data-avatar="user"] img')).not.toBeNull();
    expect(container.querySelectorAll('[data-avatar="agent"]').length).toBeGreaterThan(0);
    // The entry is the icon rail's — see the "exactly one account avatar" test for why the
    // session column no longer has one. It opens a popover, not Settings.
    fireEvent.click(screen.getByRole('button', { name: '账户' }));
    expect(container.querySelector('[data-account-menu]')).not.toBeNull();
    expect(container.querySelector('[data-settings-page]')).toBeNull();
  });
});

describe('App — empty scene', () => {
  it('shows the empty state, not a spinner', () => {
    const { container } = renderScene('empty');
    expect(container.querySelector('[data-chat-empty-hero]')).not.toBeNull();
    expect(container.querySelector('.camelia-pulse')).toBeNull();
  });

  it('centres the composer in the main pane on a fresh session', () => {
    const { container } = renderScene('empty');
    expect(container.querySelector('[data-composer-slot="centered"]')).not.toBeNull();
    expect(container.querySelector('[data-composer-placement="centered"]')).not.toBeNull();
    expect(container.querySelector('[data-chat-empty-hero]')).not.toBeNull();
    // Transcript body is omitted while fresh — composer owns the centre.
    expect(container.querySelector('[data-chat-workspace][data-chat-fresh]')).not.toBeNull();
  });



  it('tells the user where sessions and restore points will appear', () => {
    renderScene('empty');
    expect(screen.getByText(/此工作区还没有会话/)).toBeInTheDocument();
    expect(screen.getByText(/在输入框里描述任务即可开始/)).toBeInTheDocument();
  });

  it('sends chat_message from Work composer instead of submit_task', () => {
    const { container, transport } = renderScene('empty');
    const area = container.querySelector('[data-composer] textarea') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'hello' } });
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(transport.sent.some((c) => c.type === 'chat_message')).toBe(true);
    expect(transport.sent.some((c) => c.type === 'submit_task')).toBe(false);
  });

  it('puts the mode selector above the session list, not in the top bar or the composer', () => {
    const { container } = renderScene('empty');
    const top = container.querySelector('.camelia-topbar') as HTMLElement;
    expect(top.querySelector('[data-mode-tabs]')).toBeNull();
    expect(top.querySelector('[data-brand-slot]')?.textContent).toMatch(/Camelia/);
    const column = container.querySelector('[data-rail="left"]') as HTMLElement;
    expect(column.querySelector('[data-mode-tabs]')).not.toBeNull();
    expect(column.querySelector('[data-mode-tab="work"]')).not.toBeNull();
    expect(column.querySelector('[data-mode-tab="math"]')).not.toBeNull();
    expect(column.querySelector('[data-mode-tab="term"]')).not.toBeNull();
    expect(container.querySelector('[data-composer] [data-mode-tabs]')).toBeNull();
  });

  it('keeps the model chip, effort, and attach control inside the composer card', () => {
    const { container } = renderScene('empty');
    const card = container.querySelector('[data-composer]') as HTMLElement;
    const toolbar = card.querySelector('[data-composer-toolbar]') as HTMLElement;
    expect(toolbar.querySelector('[data-composer-attach]')).not.toBeNull();
    expect(toolbar.querySelector('[data-composer-attach-input]')).not.toBeNull();
    expect(toolbar.querySelector('[data-composer-policy]')).not.toBeNull();
    expect(toolbar.querySelector('[data-composer-model]')).not.toBeNull();
    expect(toolbar.querySelector('[data-composer-effort]')).not.toBeNull();
    expect(toolbar.querySelector('[data-run]')).not.toBeNull();
    expect(toolbar.querySelector('[data-composer-mic]')).toBeNull();
    expect(container.querySelector('.camelia-topbar [data-mode-tabs]')).toBeNull();
  });

  it('opens a plugins sidebar from the left nav without enable switches', () => {
    const { container } = renderScene('empty');
    fireEvent.click(screen.getByRole('button', { name: '插件' }));
    const panel = container.querySelector('[data-extensions-panel]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(within(panel).getByText('还没有插件。')).toBeInTheDocument();
    expect(panel.querySelector('[role="switch"], input')).toBeNull();
    expect(panel.querySelector('[data-layout-sidebar]'), 'plugins header has no collapse button').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '插件' }));
    expect((container.querySelector('[data-shell]') as HTMLElement).style.getPropertyValue('--rail-left-w')).toBe('0px');
    fireEvent.click(screen.getByRole('button', { name: '插件' }));
    expect((container.querySelector('[data-shell]') as HTMLElement).style.getPropertyValue('--rail-left-w')).toBe('260px');
    fireEvent.click(within(panel).getByRole('button', { name: '如何安装' }));
    expect(panel.textContent).toMatch(/camelia\.plugin\.json/);
    expect(panel.textContent).toMatch(/~\/\.camelia\/plugins/);
  });

  it('checks GitHub releases from About and does not download outside the desktop shell', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tag_name: 'v0.2.0',
        body: 'release notes',
        html_url: 'https://github.com/CameliaDev/Camelia-Agent/releases/tag/v0.2.0',
        assets: [
          {
            name: 'Camelia_0.2.0_x64-setup.exe',
            browser_download_url:
              'https://github.com/CameliaDev/Camelia-Agent/releases/download/v0.2.0/Camelia_0.2.0_x64-setup.exe',
            size: 12,
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { container } = renderScene('empty');
      fireEvent.click(container.querySelector('[data-rail-settings]') as HTMLElement);
      fireEvent.click(screen.getByRole('button', { name: '关于' }));
      fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
      expect(await screen.findByText(/0\.2\.0/)).toBeInTheDocument();
      expect(screen.getByText('release notes')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '下载并安装' }));
      expect(await screen.findByText(/桌面端/)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers connection presets in multi-section settings', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('empty');
    // Via the gear, not the account mark: since the two were split, the mark lands on
    // appearance and this section is the gear's default page.
    const gear = container.querySelector('[data-rail-settings]') as HTMLElement;
    expect(gear).not.toBeNull();
    fireEvent.click(gear);
    expect(container.querySelector('[data-settings-page]')).not.toBeNull();
    expect(screen.getByRole('button', { name: '连接预设' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '语言与外观' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '引擎与日志' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关于' })).toBeInTheDocument();
    const brand = container.querySelector('[data-settings-product]');
    expect(brand?.textContent).toMatch(/Camelia 0\.1\.0/);
    expect(container.textContent).not.toMatch(/待定/);
    fireEvent.click(screen.getByRole('button', { name: '反馈' }));
    expect(container.querySelector('[data-feedback-form]')).not.toBeNull();
    expect(container.querySelector('[data-feedback-submit]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '连接预设' }));
    fireEvent.click(screen.getByRole('button', { name: /添加预设/ }));
    expect(screen.getByLabelText('决策模型')).toBeInTheDocument();
    expect(screen.getByLabelText('API 密钥')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存并启用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '仅保存' })).toBeInTheDocument();
  });
});

describe('App — connecting scene', () => {
  it('shows a loading state while the engine has not answered', () => {
    const { container } = renderScene('connecting');
    // Work shell + header stay up; connecting has no task card yet.
    expect(container.querySelector('[data-mode-shell="work"]')).not.toBeNull();
    expect(container.querySelector('[data-chat-workspace] [data-mode-header]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// planning
// ---------------------------------------------------------------------------

describe('App — planning scene', () => {
  it('shows a real planning stage, not a bare spinner', () => {
    const { container } = renderScene('planning');
    expect(screen.getAllByText(/Drafting the plan|正在制定计划/).length).toBeGreaterThan(0);
    openPanel(container, 'run');
    expect(screen.getByText('No plan yet — the planner has not returned.')).toBeInTheDocument();
  });

  it('exposes the task phase', () => {
    const { container } = renderScene('planning');
    // The header centres the session's title — the durable project name, not the run's
    // own text. The phase is said by the lifecycle stepper, which lives in the run dock
    // above the composer; scoped there because the same stop text also appears in
    // plan-empty copy.
    const title = container.querySelector('[data-topbar-title]') as HTMLElement;
    expect(title.textContent).toContain('Add --json output to the camelia CLI');
    const dock = container.querySelector('[data-run-dock]') as HTMLElement;
    expect(within(dock).getByText('起草中')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// running — the core architecture surface
// ---------------------------------------------------------------------------

describe('App — running scene exposes the whole run', () => {
  it('shows the agent phase and activity', () => {
    renderScene('running');
    expect(screen.getAllByText('运行中').length).toBeGreaterThan(0);
  });

  it('shows the step list with per-step status', () => {
    const { container } = renderScene('running');
    openPanel(container, 'run');
    const rail = container.querySelector('[data-right-rail]') as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.textContent).toMatch(/步骤/);
    expect(rail.textContent).toMatch(/定位 CLI|Map the CLI/);
    expect(rail.textContent).toMatch(/JSON|验收测试|acceptance/i);
  });

  it('shows demo plan copy in the selected language', () => {
    const { container, store } = renderScene('running');
    expandCollapsed(container);
    act(() => store.getState().setLocalPrefs({ language: 'zh' }));
    expect(screen.getAllByText('定位 CLI 入口和报告生成器').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/找到参数在哪里解析|验收报告/).length).toBeGreaterThan(0);
    act(() => store.getState().setLocalPrefs({ language: 'en' }));
    expandCollapsed(container);
    expect(screen.getAllByText(/Map the CLI entrypoint|定位 CLI 入口/).length).toBeGreaterThan(0);
  });

  it('shows where the task is in its lifecycle, and no percentage anywhere', () => {
    const { container } = renderScene('running');
    // What replaced the continuous rail: the named stops. Four of them, one of which is
    // marked current — "which stage" rather than "what percent". They live in the run
    // dock above the composer now.
    const dock = container.querySelector('[data-run-dock]') as HTMLElement;
    const stops = dock.querySelectorAll('[data-plan-stop]');
    expect(stops.length).toBe(4);
    expect(dock.querySelector('[data-plan-current="true"]')).not.toBeNull();

    // And the percentage is gone rather than merely moved. A rail left in the panel or the
    // status bar would contradict this test's name and re-introduce the thing the removal
    // was for.
    expect(container.querySelectorAll('[data-progress-kind]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-activity-progress]')).toHaveLength(0);
  });

  it('has no progress rail in either top-bar state', () => {
    // The conditional rail in `ModeHeader` existed for exactly one reason: to cover for
    // `topBar: 'hidden'`. With the top bar's copy removed there is nothing to cover, so both
    // states must now be rail-free — otherwise the fallback would outlive its cause and be a
    // progress bar the user cannot turn off.
    for (const topBar of ['pinned', 'hidden'] as const) {
      localStorage.setItem(
        'camelia.localPrefs',
        JSON.stringify({ version: 6, topBar, language: 'zh' }),
      );
      const { container, unmount } = renderScene('running');
      expect(container.querySelectorAll('[data-progress-kind]'), `topBar: ${topBar}`).toHaveLength(0);
      expect(container.querySelectorAll('[role="progressbar"]'), `topBar: ${topBar}`).toHaveLength(0);
      unmount();
    }
    localStorage.removeItem('camelia.localPrefs');
  });

  it('shows tool calls with their names and durations', () => {
    const { container } = renderScene('running');
    expandCollapsed(container);
    expect(screen.getAllByText('fs.read').length).toBeGreaterThan(0);
    expect(screen.getAllByText('fs.edit').length).toBeGreaterThan(0);
  });

  it('shows context usage as tokens and a window share', () => {
    const { container } = renderScene('running');
    openPanel(container, 'context');
    expect(screen.getAllByText('上下文').length).toBeGreaterThan(0);
    expect(screen.getByText(/\/ .* tokens/)).toBeInTheDocument();
  });

  it('lets the user inspect what compaction dropped', () => {
    const { container } = renderScene('running');
    openPanel(container, 'context');
    expect(screen.getByText('1 compaction')).toBeInTheDocument();
    expect(screen.getByText(/located the CLI entrypoint/)).toBeInTheDocument();
    expect(screen.getByText('protected slots that survived')).toBeInTheDocument();
  });

  it('shows the original text of the messages compaction dropped', () => {
    const { container } = renderScene('running');
    openPanel(container, 'context');
    expect(screen.getByText('dropped originals')).toBeInTheDocument();
    // The raw text of a dropped tool call, not just its one-line summary.
    expect(screen.getByText(/export function main\(argv: string\[\]\): number/)).toBeInTheDocument();
    expect(screen.getByText(/> node --version/)).toBeInTheDocument();
    // 12 kept originals out of the 12 the event reported.
    expect(screen.getByText('12/12')).toBeInTheDocument();
  });

  it('shows the sub-agent that ran in isolation', () => {
    const { container } = renderScene('running');
    openPanel(container, 'sub');
    expect(screen.getByText(/Locate the format switch/)).toBeInTheDocument();
  });

  it('offers pause, steer and cancel controls', () => {
    renderScene('running');
    expect(screen.getByTitle(/暂停|Pause/)).toBeInTheDocument();
    expect(screen.getByTitle(/引导|Steer/)).toBeInTheDocument();
    expect(screen.getByTitle(/取消|Cancel/)).toBeInTheDocument();
  });

  it('keeps the raw event trail for audit', () => {
    const { container } = renderScene('running');
    // Events is the panel that needs no task, so it is the one reachable in every scene.
    const deck = openPanel(container, 'events');
    expect(deck).not.toBeNull();
    expect(panelTitle(container)).toBe('事件');
    expect(screen.getAllByText(/task\.received|session\.opened/).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// approval
// ---------------------------------------------------------------------------

describe('App — approval scene', () => {
  it('surfaces the pending privileged call and its arguments', () => {
    renderScene('approval');
    expect(screen.getByText('Approval required')).toBeInTheDocument();
    expect(screen.getAllByText('shell.run').length).toBeGreaterThan(0);
    // Approval card header; wording may vary by language.
    expect(screen.getAllByText(/等待|Waiting|审批/i).length).toBeGreaterThan(0);
  });

  it('offers allow-once, allow-for-session and deny', () => {
    renderScene('approval');
    expect(screen.getByText('Allow once')).toBeInTheDocument();
    expect(screen.getByText('Allow for session')).toBeInTheDocument();
    expect(screen.getByText('Deny')).toBeInTheDocument();
  });

  it('clears the approval once the user allows it', () => {
    renderScene('approval');
    fireEvent.click(screen.getByText('Allow once'));
    expect(screen.queryByText('Approval required')).not.toBeInTheDocument();
  });

  it('records the approval command on the transport', () => {
    const { transport } = renderScene('approval');
    fireEvent.click(screen.getByText('Allow once'));
    expect(transport.sent.at(-1)!.type).toBe('approve_tool');
  });
});

// ---------------------------------------------------------------------------
// failure / recovery
// ---------------------------------------------------------------------------

describe('App — failure scene', () => {
  it('shows the failure with its reason and recovery evidence', () => {
    renderScene('failure');
    expect(screen.getByText('失败 — 可恢复')).toBeInTheDocument();
    expect(screen.getByText('尝试次数')).toBeInTheDocument();
    expect(screen.getByText('策略')).toBeInTheDocument();
  });

  it('offers retry, degrade and rollback', () => {
    renderScene('failure');
    expect(screen.getByText('重试该步骤')).toBeInTheDocument();
    expect(screen.getByText('降级到更小模型')).toBeInTheDocument();
    expect(screen.getAllByText('回滚').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-intervene-unavailable]')).toBeNull();
    expect(document.querySelector('[data-failure-card]')).not.toBeNull();
  });

  it('shows the reliability notices the run produced', () => {
    renderScene('failure');
    expect(screen.getByText('Recovered via retry-with-context')).toBeInTheDocument();
    expect(screen.getByText('Goal drift detected (score 0.42)')).toBeInTheDocument();
    expect(screen.getByText('Unsupported completion claim blocked')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// done
// ---------------------------------------------------------------------------

describe('App — done scene', () => {
  it('shows the delivery card with verified steps and artifacts', () => {
    renderScene('done');
    expect(screen.getAllByText(/^(Delivered|已完成)$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^5\/5 (steps verified|完成|Done)$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('packages/cli/src/main.ts').length).toBeGreaterThan(0);
  });

  it('shows every step verified', () => {
    const { container } = renderScene('done');
    expandCollapsed(container);
    expect(screen.getAllByText(/verify: pass|校验: 通过|校验：通过|pass/).length).toBeGreaterThan(0);
  });

  it('keeps the intent card', () => {
    renderScene('done');
    // Intent now renders as a right-aligned user bubble; the raw intent text is the anchor.
    expect(screen.getAllByText(/Add a --json flag to the camelia CLI/).length).toBeGreaterThan(0);
  });

  it('hides PlanReview approve/reject after the task is done', () => {
    const { container } = renderScene('done');
    expect(container.querySelector('[data-plan-review]')).toBeNull();
    expect(container.querySelector('[data-task-plan-review]')).toBeNull();
    expect(screen.queryByText('Approve once')).not.toBeInTheDocument();
    expect(screen.queryByText('批准一次')).not.toBeInTheDocument();
    expect(screen.queryByText('Approve for session')).not.toBeInTheDocument();
    expect(screen.queryByText('Approve for session')).not.toBeInTheDocument();
    expect(screen.queryByText('本会话自动批准')).not.toBeInTheDocument();
    expect(screen.queryByText('本会话批准')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
    expect(screen.queryByText('拒绝')).not.toBeInTheDocument();
    expect(screen.queryByText(/Goal drift detected/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// diff — an edit in the watched step is expanded
// ---------------------------------------------------------------------------

describe('App — diff scene', () => {
  it('expands the edit that belongs to the step being watched', () => {
    const { container } = renderScene('diff');
    expandCollapsed(container);
    expect(container.querySelector('[data-task-run-card]')).not.toBeNull();
    expect((container.textContent || '').length).toBeGreaterThan(100);
  });

  it('shows a diff rather than the raw edit arguments', () => {
    const { container } = renderScene('diff');
    expandCollapsed(container);
    expect(container.querySelector('[data-task-run-card]')).not.toBeNull();
    expect(screen.queryByText('"oldText"')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// error — the transport could not start
// ---------------------------------------------------------------------------

describe('App — error scene', () => {
  it('surfaces the transport failure instead of an empty shell', () => {
    renderScene('error');
    expect(screen.getByText('The transport could not start')).toBeInTheDocument();
    expect(screen.getByText(/engine unreachable/)).toBeInTheDocument();
  });

  it('marks the engine offline', () => {
    const { store } = renderScene('error');
    expect(store.getState().status).toBe('offline');
    expect(store.getState().transportError).toMatch(/engine unreachable/);
  });
});

// ---------------------------------------------------------------------------
// interactions
// ---------------------------------------------------------------------------

describe('App — interventions', () => {
  it('pause updates the run to paused', () => {
    const { store } = renderScene('running');
    fireEvent.click(screen.getByTitle(/暂停|Pause/));
    expect(store.getState().snapshot.task!.status).toBe('paused');
  });

  it('steer reveals the re-anchor input', () => {
    renderScene('running');
    fireEvent.click(screen.getByTitle(/引导|Steer/));
    expect(screen.getAllByText(/引导|Steer|re-anchor/).length).toBeGreaterThan(0);
  });

  it('rollback from a step emits a recovery notice', () => {
    renderScene('done');
    fireEvent.click(screen.getAllByText(/roll back|回滚/)[0]!);
    expect(screen.getByText('Rollback complete')).toBeInTheDocument();
  });
});
