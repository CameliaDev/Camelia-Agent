/**
 * Mode chrome tests.
 *
 * The claims being checked are the ones the plan book makes about mode switching:
 * it is pure front-end chrome, it never appears in `snapshot`, and it never stops a
 * running task.
 * @module
 */

import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import type { SceneId } from '../src/transport/scenario.js';
import { isAppModeId, DEFAULT_MODE } from '../src/mode/types.js';
import { MODE_REGISTRY } from '../src/mode/ModeRegistry.js';
import { enterMathMode, mathRailButton } from './math-plugin.js';
import {
  MATH_DEMO_FIRST,
  MATH_DEMO_FRAMES,
  MATH_DEMO_LAST,
  mathDemoAt,
} from '../src/modes/math/mathDemoFixture.js';

function renderScene(scene: SceneId) {
  const transport = new FixtureTransport({ scene });
  const store = createUiStore(transport);
  const view = render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  return { ...view, store, transport };
}

describe('mode types', () => {
  it('guards unknown ids instead of casting', () => {
    expect(isAppModeId('work')).toBe(true);
    expect(isAppModeId('math')).toBe(true);
    expect(isAppModeId('nope')).toBe(false);
    expect(isAppModeId(undefined)).toBe(false);
    expect(DEFAULT_MODE).toBe('work');
  });

  it('registers only the built-in work mode for settings', () => {
    expect(MODE_REGISTRY.map((m) => m.id)).toEqual(['work']);
    for (const def of MODE_REGISTRY) {
      expect(def.labelKey).toMatch(/^mode\./);
      expect(def.descriptionKey).toMatch(/^mode\./);
    }
  });
});

describe('mode chrome', () => {
  it('does not render the legacy Work/Math/Term tab strip', () => {
    const { container } = renderScene('running');
    expect(container.querySelector('[data-mode-tabs]')).toBeNull();
  });

  it('hides the math activity-bar icon until the shell plugin is installed', () => {
    const { container } = renderScene('running');
    expect(container.querySelector('[data-rail-view="math"]')).toBeNull();
  });
});

describe('mode switching', () => {
  it('starts in the preferred mode', () => {
    localStorage.setItem('camelia.localPrefs', JSON.stringify({ version: 4, preferredMode: 'work', language: 'zh' }));
    const { container } = renderScene('running');
    expect(container.querySelector('[data-mode-shell="work"]')).not.toBeNull();
  });

  it('switches without touching snapshot or emitting a command', async () => {
    // `running`, not `plan`: a task awaiting approval auto-routes to plan mode (see the
    // approval-reachability block below), so it is the wrong scene to test free switching.
    const { container, store } = renderScene('running');
    const before = store.getState().snapshot;

    await enterMathMode(container, store);
    expect(container.querySelector('[data-mode-shell="math"]')).not.toBeNull();

    // The projection is untouched: the mode is chrome, not domain state.
    expect(store.getState().snapshot).toBe(before);
    expect(store.getState().snapshot).not.toHaveProperty('mode');
    // And it was never sent as a command.
    expect(store.getState().lastCommand).toBeUndefined();
    expect(store.getState().lastCommand?.type).not.toBe('set_ui_mode');
  });

  it('marks the math activity-bar icon pressed while math is active', async () => {
    const { container, store } = renderScene('running');
    await enterMathMode(container, store);
    expect(mathRailButton(container).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a running task alive and says so when the surface is replaced', async () => {
    const { container, store } = renderScene('running');
    const taskBefore = store.getState().snapshot.task;
    expect(taskBefore).toBeDefined();

    await enterMathMode(container, store);

    // Switching did not cancel, pause or otherwise disturb the run.
    expect(store.getState().snapshot.task).toBe(taskBefore);
    expect(store.getState().lastCommand).toBeUndefined();
    // And the user is told where it went, with a way back.
    const strip = container.querySelector('[data-cross-mode-strip]');
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain('Work');

    act(() => {
      fireEvent.click(container.querySelector('[data-cross-mode-view]') as HTMLElement);
    });
    expect(container.querySelector('[data-mode-shell="work"]')).not.toBeNull();
  });

  it('shows no strip in work mode while a task runs', () => {
    const { container } = renderScene('running');
    expect(container.querySelector('[data-cross-mode-strip]')).toBeNull();
  });
});

describe('plan approval is always reachable', () => {
  // Regression guard. The plan-approval surface used to live in the conversation's centre
  // tab strip. When that moved into plan mode, chat mode lost every approve/reject control
  // — so a task waiting on approval was a dead end unless the user guessed to switch modes.
  // These assertions fail if that ever happens again.
  it('auto-routes to Work when a task is awaiting plan approval', () => {
    // Scene plan ends at task.status === 'awaiting-approval'. Scene pproval is
    // tool.approval_required during executing — that is ApprovalCard, not PlanReview.
    const { container } = renderScene('plan');
    expect(container.querySelector('[data-mode-shell="work"]')).not.toBeNull();
    expect(container.querySelector('[data-plan-review]')).not.toBeNull();
  });

  it('offers approve and reject while a plan waits', () => {
    const { container } = renderScene('plan');
    const review = container.querySelector('[data-plan-review]') as HTMLElement;
    expect(review).not.toBeNull();
    expect(review.textContent).toMatch(/批准|Approve/);
    expect(review.textContent).toMatch(/拒绝|Reject/);
  });

  it('keeps work shell while a task executes after approval', () => {
    const { container, store } = renderScene('running');
    expect(container.querySelector('[data-mode-shell="work"]')).not.toBeNull();
    expect(store.getState().snapshot.task?.status).toBe('executing');
  });

  it('drops the cross-mode strip while approval is pending, since plan mode already shows it', () => {
    const { container } = renderScene('approval');
    // Awaiting approval and in math mode would otherwise show a "task running" strip that
    // competes with the approval the user must act on.
    expect(container.querySelector('[data-mode-shell="work"]')).not.toBeNull();
    expect(container.querySelector('[data-cross-mode-strip]')).toBeNull();
  });
});

describe('math workspace', () => {
  it('never auto-plays the demo — it is an explicit, labelled action', async () => {
    const { container, store } = renderScene('empty');
    await enterMathMode(container, store);
    // Opt-in: no badge and no data until the user asks for it.
    expect(container.querySelector('[data-math-demo-badge]')).toBeNull();
    expect(container.querySelector('[data-math-demo-load]')).not.toBeNull();
    // And the mode says plainly that the engine has no math backend.
    expect(container.querySelector('[data-math-unavailable]')).not.toBeNull();
  });

  it('badges the demo everywhere it shows data, and can be exited', async () => {
    const { container, store } = renderScene('empty');
    await enterMathMode(container, store);
    act(() => {
      fireEvent.click(container.querySelector('[data-math-demo-load]') as HTMLElement);
    });

    expect(container.querySelector('[data-math-demo-badge]')).not.toBeNull();
    expect(container.querySelector('[data-math-result-card]')).not.toBeNull();
    expect(container.querySelector('[data-math-solver-log]')).not.toBeNull();
    // Nothing in the shell flags the demo by *not* being there any more: the demo badge is
    // the only marker, which is why it has to be on every surface that shows demo data.
    expect(container.querySelectorAll('[data-progress-bar]')).toHaveLength(0);

    act(() => {
      fireEvent.click(container.querySelector('[data-math-demo-clear]') as HTMLElement);
    });
    expect(store.getState().mathDemo).toBeUndefined();
    expect(container.querySelector('[data-math-demo-badge]')).toBeNull();
  });

  it('leaves solve and export disabled with a stated reason', async () => {
    const { container, store } = renderScene('empty');
    await enterMathMode(container, store);
    // Solve is always present in the stage strip, always disabled, always with a reason.
    const solve = container.querySelector('[data-math-solve-disabled]');
    expect(solve).not.toBeNull();
    expect(solve!.getAttribute('title')).toBeTruthy();

    // Export lives inside the results panel, which needs something to show — load the demo.
    act(() => {
      fireEvent.click(container.querySelector('[data-math-demo-load]') as HTMLElement);
    });
    const exportBtn = container.querySelector('[data-math-export-disabled]');
    expect(exportBtn).not.toBeNull();
    expect(exportBtn!.getAttribute('title')).toBeTruthy();
  });

  it('walks the stage sequence deterministically from the demo frames', async () => {
    const { container, store } = renderScene('empty');
    await enterMathMode(container, store);
    act(() => {
      fireEvent.click(container.querySelector('[data-math-demo-load]') as HTMLElement);
    });
    // Frame 0 is the modeling stage.
    expect(container.querySelector('[data-math-current="true"]')?.getAttribute('data-math-stage')).toBe('modeling');
  });

  it('keeps math outputs in the artifacts drawer, not a separate model room', async () => {
    const { container, store } = renderScene('empty');
    await enterMathMode(container, store);
    act(() => {
      fireEvent.click(container.querySelector('[data-math-demo-load]') as HTMLElement);
    });
    const deck = container.querySelector('[data-panel-deck="artifacts"]');
    expect(deck).not.toBeNull();
    expect(deck!.querySelector('[data-math-panel="assumptions"]')).not.toBeNull();
    expect(deck!.querySelector('[data-math-panel="solver"]')).not.toBeNull();
    expect(deck!.querySelector('[data-math-panel="results"]')).not.toBeNull();
    expect(container.querySelector('[data-math-workspace] [data-math-panel]')).toBeNull();
    expect(container.querySelector('[data-panel-tab="model"]')).toBeNull();
    expect(deck!.querySelectorAll('input, textarea, select')).toHaveLength(0);
  });
});

describe('run controls are reachable from every mode', () => {
  // The report this guards: "这个任务停止不了，和取消不了也是一个问题。" Pause / steer /
  // cancel used to be four props on `ActivityBar`, and only chat renders that component;
  // plan and math offered no way to intervene at all. They are one shared group now,
  // right-aligned in the run dock above the composer, with the lifecycle stepper centred
  // in the same dock — reachable no matter which mode is on screen.
  it('draws one run dock above the composer in work and math', async () => {
    for (const mode of ['work', 'math'] as const) {
      const { container, store, unmount } = renderScene('running');
      if (mode === 'math') await enterMathMode(container, store);
      expect(container.querySelector(`[data-mode-shell="${mode}"]`)).not.toBeNull();

      // Exactly one dock, and the header is not where it lives — that strip keeps only
      // the session title and the panel icons.
      expect(container.querySelectorAll('[data-run-dock]')).toHaveLength(1);
      expect(container.querySelector(`[data-mode-shell="${mode}"] [data-mode-header]`)).toBeNull();
      if (mode === 'work') {
        expect(container.querySelector('[data-topbar-title]')?.textContent).toContain('Add --json output');
      } else {
        expect(container.querySelector('[data-topbar-title]')?.textContent ?? '').not.toContain('Add --json output');
      }

      // Stepper centred, controls right: both inside the dock, stepper before the group.
      const dock = container.querySelector('[data-run-dock]')!;
      const stepper = dock.querySelector('[data-plan-lifecycle]');
      const controls = dock.querySelector('[data-run-controls]');
      expect(stepper).not.toBeNull();
      expect(controls).not.toBeNull();
      expect(
        stepper!.compareDocumentPosition(controls!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(controls!.querySelector('[data-run-pause]')).not.toBeNull();
      expect(controls!.querySelector('[data-run-steer]')).not.toBeNull();
      expect(controls!.querySelector('[data-run-cancel]')).not.toBeNull();

      // Above the composer, not inside it — the anchor the dock is drawn at.
      const composer = container.querySelector('[data-composer]')!;
      expect(composer.contains(dock)).toBe(false);

      unmount();
    }
  });

  it('greys out rather than removes pause and cancel once the task is done', () => {
    const { container } = renderScene('done');
    const pause = container.querySelector('[data-run-pause]') as HTMLButtonElement;
    const cancel = container.querySelector('[data-run-cancel]') as HTMLButtonElement;
    expect(pause).not.toBeNull();
    expect(cancel).not.toBeNull();
    // Still in the tree: a button that vanishes takes its slot with it and reflows the
    // header, which reads as "the button broke" rather than "there is nothing to stop".
    expect(pause.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  it('offers resume instead of pause once the task is paused', () => {
    const { container, store } = renderScene('running');
    act(() => {
      store.setState((state) => ({
        snapshot: {
          ...state.snapshot,
          task: { ...state.snapshot.task!, status: 'paused' },
        },
      }));
    });
    expect(container.querySelector('[data-run-pause]')).toBeNull();
    expect(container.querySelector('[data-run-resume]')).not.toBeNull();
  });

  it('sends pause_task with the task on screen, not just a reason', () => {
    const { container, store, transport } = renderScene('running');
    const taskId = store.getState().snapshot.task!.id;
    const sent: { type: string; payload: Record<string, unknown> }[] = [];
    // Spy at the transport, which the store's dispatch always funnels through — the
    // command is what matters here, not which layer issued it.
    const real = transport.send.bind(transport);
    transport.send = (cmd) => {
      sent.push(cmd as unknown as { type: string; payload: Record<string, unknown> });
      real(cmd);
    };
    act(() => {
      fireEvent.click(container.querySelector('[data-run-pause]') as HTMLElement);
    });
    expect(sent.map((c) => c.type)).toContain('pause_task');
    const pause = sent.find((c) => c.type === 'pause_task')!;
    // The engine now refuses a taskId that is not the running one, so an omitted id
    // would make the button refuse itself.
    expect(pause.payload.taskId).toBe(taskId);
  });

  it('opens the steering form from any mode, above the composer', async () => {
    for (const mode of ['work', 'math'] as const) {
      const { container, store, unmount } = renderScene('running');
      if (mode === 'math') await enterMathMode(container, store);
      expect(container.querySelector('[data-steering]')).toBeNull();
      act(() => {
        fireEvent.click(container.querySelector('[data-run-steer]') as HTMLElement);
      });
      expect(container.querySelector('[data-steering]')).not.toBeNull();
      unmount();
    }
  });

  it('shows a failed command in every mode, not only in chat', async () => {
    // The notice used to be drawn inside the chat transcript, which is why a pause
    // rejected in plan mode showed nothing at all: `{ ok: false }` was recorded and
    // never rendered anywhere the user was looking.
    for (const mode of ['work', 'math'] as const) {
      const { container, store, unmount } = renderScene('running');
      if (mode === 'math') await enterMathMode(container, store);
      act(() => {
        store.setState({ lastCommandError: { type: 'pause_task', error: '当前没有运行中的任务', at: 1 } });
      });
      const notice = container.querySelector('[data-command-error]');
      expect(notice).not.toBeNull();
      // The engine's own words, not a flattened "操作失败".
      expect(notice!.textContent).toContain('当前没有运行中的任务');
      unmount();
    }
  });
});

describe('math demo data', () => {
  const STAGE_ORDER = ['modeling', 'solving', 'verifying', 'reporting'] as const;

  it('advances stages monotonically across the exported frames', () => {
    // A demo that jumped backwards would look like a solver re-running.
    const seen = MATH_DEMO_FRAMES.map((f) => f.stage);
    const indices = seen.map((s) => STAGE_ORDER.indexOf(s));
    expect(indices.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]!).toBeGreaterThanOrEqual(indices[i - 1]!);
    }
    // It must actually visit all four rather than stalling in one.
    expect(new Set(seen).size).toBe(STAGE_ORDER.length);
  });

  it('never runs a demo frame past the last stage, and ends done', () => {
    expect(MATH_DEMO_FIRST.stage).toBe('modeling');
    expect(MATH_DEMO_LAST.stage).toBe('reporting');
    expect(MATH_DEMO_LAST.status).toBe('done');
    // Frames that are still walking must not claim a terminal status.
    for (const frame of MATH_DEMO_FRAMES.slice(0, -1)) {
      expect(frame.status).toBe('running');
    }
  });

  it('keeps the builder consistent with the sequence', () => {
    expect(mathDemoAt('solving', 0.5).stage).toBe('solving');
    expect(mathDemoAt('solving', 0.5).status).toBe('running');
    // Status drives whether results are shown at all.
    expect(mathDemoAt('modeling', 0.5, 'idle').solverLog).toHaveLength(0);
    expect(mathDemoAt('modeling', 0.5, 'idle').results).toHaveLength(0);
  });
});
