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
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import type { SceneId } from '../src/transport/scenario.js';

function renderScene(scene: SceneId) {
  const transport = new FixtureTransport({ scene });
  const store = createUiStore(transport);
  const view = render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  // 对话 mode now shows the chat transcript, not the task surface — the two modes
  // diverge at the workspace level. This file is the task-surface checklist, so it
  // starts in plan mode, whose workspace *is* the task transcript. Tests that need
  // the chat surface click the chat tab explicitly, or live in chat-mode.test.tsx.
  act(() => {
    fireEvent.click(view.container.querySelector('[data-mode-tab="plan"]') as HTMLElement);
  });
  return { ...view, store, transport };
}

/**
 * Open a panel from the mode header's icon row and return its title.
 *
 * The panels used to live in a right rail behind an expand toggle plus a tablist. They now
 * hang off the header (PanelIcons) and render into the main area's deck (PanelDeck), so
 * a test that wants to read the run steps clicks the icon, not a tab.
 */
function openPanel(container: HTMLElement, id: string): HTMLElement {
  const icon = container.querySelector(`[data-panel-icon="${id}"]`) as HTMLElement | null;
  if (!icon) throw new Error(`panel icon not found: ${id}`);
  fireEvent.click(icon);
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
  // Wireframe v3: the top bar grew to h-11 to hold mode tabs + the progress rail, and its
  // height is published as `--top-bar-h` so the grid's padding and the overlay agree.
  it('renders the top bar and default rail widths from CSS variables', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');
    expect(container.querySelector('.h-11')).not.toBeNull();
    const shell = container.querySelector('[data-shell]') as HTMLElement;
    expect(shell.style.getPropertyValue('--top-bar-h')).toBe('44px');
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');
    // The permanent icon rail outside the left column. Its width is not draggable, so it
    // is asserted here as a constant rather than as a stored preference.
    expect(shell.style.getPropertyValue('--rail-icon-w')).toBe('48px');
    expect(container.querySelector('[data-rail="icon"]')).not.toBeNull();
    expect(container.querySelector('[data-rail="left"]')).not.toBeNull();
    // one resizable column, so one divider
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
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
    // Three columns — the right rail's track is gone, not merely collapsed to zero.
    // A four-track template would still reserve the width and leave a dead gap.
    expect(rails.style.gridTemplateColumns).toContain('var(--rail-icon-w)');
    expect(rails.style.gridTemplateColumns).not.toContain('--rail-right-w');
    expect(rails.children).toHaveLength(3);

    const shell = container.querySelector('[data-shell]') as HTMLElement;
    // The height is published as a variable so the padding and the bar cannot drift apart.
    // 28px, deliberately NOT `TOP_BAR_H`: the bottom strip is ambient and the mode header
    // carries real state, so matching them made the quieter one the louder one.
    expect(shell.style.getPropertyValue('--status-bar-h')).toBe('28px');
  });

  it('draws the status bar with real readouts, and no controls that do nothing', () => {
    // "In case we want to put things here later" is permission to add items, not to ship
    // empty placeholders. Every cell is a readout of state that exists; a clickable
    // element in here would be a promise the shell cannot keep.
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');

    const bar = container.querySelector('[data-status-bar]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.getPropertyValue('--status-bar-h')).toBe('28px');

    for (const item of ['workspace', 'steps', 'context', 'elapsed']) {
      expect(container.querySelector(`[data-status-item="${item}"]`), item).not.toBeNull();
    }
    // No button, no link, no role that implies an action.
    expect(bar.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);
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

  it('gives every mode the same fixed-height header, so switching modes cannot shift the content', () => {
    // The three modes used to draw their own strip and measured ≈76 / ≈33 / ≈37px, so
    // changing mode moved the whole transcript. One shared `ModeHeader` owns the height;
    // these assertions are what stop a mode from drifting again.
    localStorage.removeItem('camelia.localPrefs');

    for (const mode of ['对话', '计划', '数模'] as const) {
      const { container, store } = renderScene('running');
      act(() => {
        // Mode may auto-route to plan while approval pends; force the mode under test.
        store.getState().setMode(mode === '对话' ? 'chat' : mode === '计划' ? 'plan' : 'math');
      });
      const header = container.querySelector('[data-mode-header]') as HTMLElement | null;
      expect(header, `${mode} should render a mode header`).not.toBeNull();
      expect(header!.style.height, `${mode} header height`).toBe('33px');
      // The lifecycle stepper is reachable in every mode — it lives in the run dock,
      // shared like the header strip it used to sit in.
      expect(container.querySelector('[data-plan-lifecycle]'), `${mode} stepper`).not.toBeNull();
    }

    // The same must hold with *no task at all*. Chat and plan used to return their empty
    // state before reaching the header, so an idle window had a strip in math and none in
    // chat/plan — a 33px jump on the first mode switch a new user ever makes. The height
    // is an invariant of the shell, not of having work to show.
    for (const mode of ['对话', '计划', '数模'] as const) {
      const { container, store } = renderScene('empty');
      act(() => {
        store.getState().setMode(mode === '对话' ? 'chat' : mode === '计划' ? 'plan' : 'math');
      });
      const header = container.querySelector('[data-mode-header]') as HTMLElement | null;
      expect(header, `${mode} should render a mode header even with no task`).not.toBeNull();
      expect(header!.style.height, `${mode} header height with no task`).toBe('33px');
    }
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

  it('starts with no panel open and opens Memory on the first click', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('empty');
    // Nothing is open on boot: the deck is opt-in, so it cannot eat the workspace on a
    // fresh window the way a permanently-visible rail used to.
    expect(container.querySelector('[data-panel-deck]')).toBeNull();
    const icon = container.querySelector('[data-panel-icon="memory"]') as HTMLElement;
    expect(icon, 'the memory icon lives in the mode header').not.toBeNull();
    expect(icon.closest('[data-mode-header]'), 'and the header is its host').not.toBeNull();
    fireEvent.click(icon);
    expect(panelTitle(container)).toBe('记忆');
    // Clicking again closes it — the icon is a toggle, not an "open" button.
    fireEvent.click(icon);
    expect(container.querySelector('[data-panel-deck]')).toBeNull();
  });

  it('hangs all five non-math panels off the header of every mode', () => {
    const { container } = renderScene('running');
    // The panels were a right rail, so they only existed in one place. A mode that cannot
    // reach them is a mode missing a capability the other two have — the same defect the
    // run controls had. `PanelIcons` is mounted by `ModeHeader`, so this holds everywhere.
    for (const mode of ['chat', 'plan', 'math'] as const) {
      fireEvent.click(container.querySelector(`[data-mode-tab="${mode}"]`) as HTMLElement);
      const header = container.querySelector('[data-mode-header]') as HTMLElement;
      const icons = [...header.querySelectorAll('[data-panel-icon]')].map((n) =>
        n.getAttribute('data-panel-icon'),
      );
      // Five everywhere, plus the model icon only in math.
      expect(icons).toEqual(
        mode === 'math'
          ? ['memory', 'events', 'run', 'context', 'sub', 'model']
          : ['memory', 'events', 'run', 'context', 'sub'],
      );
    }
  });

  it('dims a task-bound panel instead of hiding it', () => {
    const { container } = renderScene('empty');
    const needsTask = container.querySelector('[data-panel-icon="run"]') as HTMLElement;
    const free = container.querySelector('[data-panel-icon="memory"]') as HTMLElement;
    // No task here, so Run has nothing to show. Hiding it would move the other icons and
    // leave a ragged row; dimming it keeps the set stable and explains itself on hover.
    expect(needsTask.className).toContain('opacity-40');
    expect(free.className).not.toContain('opacity-40');
    // Still clickable — opening it shows the panel's own empty state rather than nothing.
    fireEvent.click(needsTask);
    expect(container.querySelector('[data-panel-deck="run"]')).not.toBeNull();
  });

  it('closes the deck from the panel itself, not only from the header icon', () => {
    const { container } = renderScene('running');
    openPanel(container, 'run');
    const close = container.querySelector('[data-panel-close]') as HTMLElement;
    expect(close, 'the deck carries its own dismiss').not.toBeNull();
    fireEvent.click(close);
    expect(container.querySelector('[data-panel-deck]')).toBeNull();
  });

  it('drops an open panel that the next mode cannot offer', () => {
    const { container } = renderScene('running');
    fireEvent.click(container.querySelector('[data-mode-tab="math"]') as HTMLElement);
    const icon = container.querySelector('[data-panel-icon="model"]') as HTMLElement;
    fireEvent.click(icon);
    expect(container.querySelector('[data-panel-deck="model"]')).not.toBeNull();
    // Back to chat: the model icon is gone, so a body left on screen would be something
    // open with no control that closes it.
    fireEvent.click(container.querySelector('[data-mode-tab="chat"]') as HTMLElement);
    expect(container.querySelector('[data-panel-deck]')).toBeNull();
  });

  it('renders the deck as a horizontal band above the composer', () => {
    const { container } = renderScene('running');
    openPanel(container, 'events');
    const deck = container.querySelector('[data-panel-deck]') as HTMLElement;
    const composer = container.querySelector('[data-composer]') as HTMLElement;
    // The user asked for 横着放. A band means: shrink-0 so it takes its natural height,
    // a max-height so it cannot eat the transcript, and a multi-column body grid.
    expect(deck.className).toContain('shrink-0');
    expect(deck.style.maxHeight).toBe('38vh');
    const body = deck.querySelector('[data-panel-deck] > div:last-of-type') as HTMLElement;
    expect(body.className).toContain('md:grid-cols-2');
    expect(body.className).toContain('xl:grid-cols-3');
    // No title row of its own: the body's own `SectionHeader` names the panel, and a deck
    // that repeated it would print 「事件」 twice inside one band.
    expect(deck.querySelector('[data-panel-title]')).toBeNull();
    expect(deck.querySelectorAll('section, [data-event-section]').length).toBeGreaterThan(0);
    // And it sits above the composer, as a sibling band in the work column rather than as
    // something floating over it. `[data-composer]` is the form inside `Composer`, so the
    // shared column is asserted through `main`.
    const main = deck.parentElement as HTMLElement;
    expect(main.tagName).toBe('MAIN');
    expect(deck.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(screen.queryByText('Harden the context compactor')).not.toBeInTheDocument();
    expect(titles()[0]).toBe('Add --json output to the camelia CLI');
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

  it('closes the session column to zero, then re-opens it from the rail', () => {
    writePrefs(false);
    const { container } = renderScene('running');
    const shell = container.querySelector('[data-shell]') as HTMLElement;
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');

    fireEvent.click(screen.getByRole('button', { name: '收起会话' }));
    // Zero, not a 48px strip: the rail outside already is the strip, and keeping one here
    // as well would put two re-open controls side by side for a single panel.
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('0px');
    expect(railOf(container)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '会话' }));
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');
  });

  it('carries the controls the closed column takes away, and hides them from the tab order', () => {
    writePrefs(true);
    const { container } = renderScene('running');
    const rail = railOf(container);
    expect(rail.querySelector('[data-rail-view="sessions"]')).not.toBeNull();
    expect(rail.querySelector('[data-rail-action="search"]')).not.toBeNull();
    expect(rail.querySelector('[data-rail-action="new"]')).not.toBeNull();
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

  it('splits the account mark from the settings gear, and each opens its own page', () => {
    // One button used to do both jobs, labelled "account & settings". Two entries with one
    // shared destination would be that same button wearing two icons, so this asserts the
    // destinations are genuinely distinct: the mark lands on appearance (it owns the avatar
    // and the display name), the gear on the drawer's first page.
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
    expect(within(container).getByRole('heading', { name: '语言与外观' })).toBeInTheDocument();
  });

  it('re-opens the column and lands the caret in its search field', async () => {
    writePrefs(true);
    const { container } = renderScene('running');
    expect(container.querySelector('[data-session-search]')).not.toBeNull();

    fireEvent.click(container.querySelector('[data-rail-action="search"]') as HTMLElement);
    const shell = container.querySelector('[data-shell]') as HTMLElement;
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');
    // Focus is scheduled a macrotask later: the field only exists once the column commits.
    await waitFor(() => {
      expect(document.activeElement).toBe(container.querySelector('[data-session-search]'));
    });
  });

  it('starts a chat from the rail exactly as the column does', () => {
    writePrefs(true);
    const { container, transport } = renderScene('running');
    fireEvent.click(container.querySelector('[data-rail-action="new"]') as HTMLElement);
    expect(transport.sent.filter((c) => c.type === 'new_session')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// empty / loading
// ---------------------------------------------------------------------------

describe('App — wireframe v2 chrome', () => {
  it('shows circular message avatars and opens settings from the account entry', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');
    expect(container.querySelector('[data-message="user"] [data-avatar="user"]')).not.toBeNull();
    // No avatar was ever configured, so the user side carries the Camelia mark — the
    // documented "only draw the mark when the user has not set one" rule.
    expect(container.querySelector('[data-message="user"] [data-avatar="user"] img')).not.toBeNull();
    expect(container.querySelectorAll('[data-avatar="agent"]').length).toBeGreaterThan(0);
    // The entry is the icon rail's — see the "exactly one account avatar" test for why the
    // session column no longer has one.
    fireEvent.click(screen.getByRole('button', { name: '账户' }));
    expect(container.querySelector('[data-settings-page]')).not.toBeNull();
    expect(container.querySelector('[data-settings-nav="connections"]')).not.toBeNull();
  });
});

describe('App — empty scene', () => {
  it('shows the empty state, not a spinner', () => {
    renderScene('empty');
    expect(screen.getByText('暂无任务')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/描述一个任务/)).toBeInTheDocument();
  });

  it('tells the user where sessions and restore points will appear', () => {
    renderScene('empty');
    expect(screen.getByText(/此工作区还没有会话/)).toBeInTheDocument();
    expect(screen.getByText(/从下方描述一个任务开始/)).toBeInTheDocument();
  });

  it('refuses a typed task instead of attaching the demo plan', () => {
    renderScene('empty');
    fireEvent.change(screen.getByPlaceholderText(/描述一个任务/), { target: { value: '写一个 hello' } });
    fireEvent.click(screen.getByRole('button', { name: '运行' }));
    expect(screen.queryByText('定位 CLI 入口和报告生成器')).not.toBeInTheDocument();
    expect(screen.getByText(/未连接引擎/)).toBeInTheDocument();
  });

  it('puts the mode selector in the composer, not the top bar', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');
    // The mode decides what Enter means, so the switch sits with the input whose meaning it
    // changes. Asserted as containment rather than proximity: a tablist rendered near the
    // composer but outside it would still be somewhere the eye has to travel to.
    const composer = container.querySelector('[data-composer]') as HTMLElement;
    const tabs = container.querySelector('[data-mode-tabs]') as HTMLElement;
    expect(tabs, 'the mode selector still exists').not.toBeNull();
    expect(composer.contains(tabs), 'and it is inside the composer card').toBe(true);
    const topBar = container.querySelector('header[data-tauri-drag-region]') as HTMLElement;
    expect(topBar.querySelector('[data-mode-tabs]'), 'and gone from the top bar').toBeNull();

    // It still switches the mode from there — `[data-mode-shell]` is the mode's own root.
    fireEvent.click(container.querySelector('[data-mode-tab="plan"]') as HTMLElement);
    expect(container.querySelector('[data-mode-tab="plan"]')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-mode-shell]')?.getAttribute('data-mode-shell')).toBe('plan');
  });

  it('keeps the model chip clickable with the mode tabs beside it', () => {
    // The regression this placement risks: the row was `max-w-[52%]` for the chip alone.
    // Adding a fixed-width tablist to the same row can squeeze the chip to nothing, and a
    // 0px chip is a control that cannot act — worse than a missing one.
    const { container } = renderScene('running');
    const chip = container.querySelector('[data-composer-model]') as HTMLElement;
    expect(chip).not.toBeNull();
    // It sits in the same row as the tablist, after it. Compared by containment rather than
    // by sibling index: a decorative divider in between would make the index brittle for no
    // gain, and "same row" is the property that actually matters.
    const tabs = container.querySelector('[data-mode-tabs]') as HTMLElement;
    // The chip's own wrapper is `relative` for the picker popover; the shared row is that
    // wrapper's parent.
    const row = chip.closest('div.relative')?.parentElement as HTMLElement;
    expect(row, 'the model chip has a wrapper and a row').toBeTruthy();
    expect(row.contains(tabs), 'mode tabs and model chip share one row').toBe(true);
    // And no `overflow-hidden` on the row, which would truncate the tab labels instead.
    expect(row.className).not.toContain('overflow-hidden');
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
    fireEvent.click(screen.getByRole('button', { name: /添加预设/ }));
    expect(screen.getByLabelText('决策模型')).toBeInTheDocument();
    expect(screen.getByLabelText('API 密钥')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存并启用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '仅保存' })).toBeInTheDocument();
  });
});

describe('App — connecting scene', () => {
  it('shows a loading state while the engine has not answered', () => {
    renderScene('connecting');
    expect(screen.getByText('Connecting to the engine')).toBeInTheDocument();
    expect(screen.queryByText('暂无任务')).not.toBeInTheDocument();
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
    const header = container.querySelector('[data-mode-header]') as HTMLElement;
    expect(within(header).getByText('Add --json output to the camelia CLI')).toBeInTheDocument();
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
    expect(screen.getAllByText('步骤').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/STEP 1|步骤 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/STEP 4|步骤 4/).length).toBeGreaterThan(0);
  });

  it('shows demo plan copy in the selected language', () => {
    const { store } = renderScene('running');
    act(() => store.getState().setLocalPrefs({ language: 'zh' }));
    expect(screen.getAllByText('定位 CLI 入口和报告生成器').length).toBeGreaterThan(0);
    expect(screen.getAllByText('找到参数在哪里解析，验收报告在哪里渲染。').length).toBeGreaterThan(0);
    expect(screen.getAllByText('文件存在').length).toBeGreaterThan(0);
    act(() => store.getState().setLocalPrefs({ language: 'en' }));
    expect(screen.getAllByText('Map the CLI entrypoint and the report generator').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Find where flags are parsed and where the acceptance report is rendered.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('file-exists').length).toBeGreaterThan(0);
    expect(screen.queryByText('定位 CLI 入口和报告生成器')).not.toBeInTheDocument();
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
    renderScene('running');
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
    renderScene('done');
    expect(screen.getAllByText(/verify: pass|校验: 通过|校验：通过/)).toHaveLength(5);
  });

  it('keeps the intent card', () => {
    renderScene('done');
    // Intent now renders as a right-aligned user bubble; the raw intent text is the anchor.
    expect(screen.getAllByText(/Add a --json flag to the camelia CLI/).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// diff — an edit in the watched step is expanded
// ---------------------------------------------------------------------------

describe('App — diff scene', () => {
  it('expands the edit that belongs to the step being watched', () => {
    renderScene('diff');
    // The +/- counts only render inside DiffBlock, i.e. only when the card is open.
    expect(screen.getAllByText(/^\+\d+$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^-\d+$/).length).toBeGreaterThan(0);
  });

  it('shows a diff rather than the raw edit arguments', () => {
    renderScene('diff');
    expect(screen.getAllByText("'json'").length).toBeGreaterThan(0);
    // The generic arguments view would print the JSON keys verbatim.
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
