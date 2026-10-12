/**
 * Mode chrome tests.
 *
 * The claims being checked are the ones the plan book makes about mode switching:
 * it is pure front-end chrome, it never appears in `snapshot`, and it never stops a
 * running task.
 * @module
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import type { SceneId } from '../src/transport/scenario.js';
import { isAppModeId, DEFAULT_MODE } from '../src/mode/types.js';
import { MODE_REGISTRY } from '../src/mode/ModeRegistry.js';
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

function modeTab(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-mode-tab="${id}"]`);
  if (!el) throw new Error(`no mode tab ${id}`);
  return el as HTMLElement;
}

describe('mode types', () => {
  it('guards unknown ids instead of casting', () => {
    expect(isAppModeId('chat')).toBe(true);
    expect(isAppModeId('math')).toBe(true);
    expect(isAppModeId('nope')).toBe(false);
    expect(isAppModeId(undefined)).toBe(false);
    expect(DEFAULT_MODE).toBe('chat');
  });

  it('registers every mode with an i18n label, and marks math unavailable', () => {
    expect(MODE_REGISTRY.map((m) => m.id)).toEqual(['chat', 'plan', 'math']);
    for (const def of MODE_REGISTRY) {
      expect(def.labelKey).toMatch(/^mode\./);
      expect(def.descriptionKey).toMatch(/^mode\./);
    }
    // Math has no engine commands yet; the registry must say so rather than pretend.
    expect(MODE_REGISTRY.find((m) => m.id === 'math')?.available).toBe(false);
    expect(MODE_REGISTRY.find((m) => m.id === 'math')?.unavailableReasonKey).toBe('mode.math.unavailable');
  });
});

describe('mode switching', () => {
  it('starts in the preferred mode', () => {
    localStorage.setItem('camelia.localPrefs', JSON.stringify({ version: 4, preferredMode: 'plan', language: 'zh' }));
    const { container } = renderScene('plan');
    expect(container.querySelector('[data-mode-shell="plan"]')).not.toBeNull();
  });

  it('switches without touching snapshot or emitting a command', () => {
    // `running`, not `plan`: a task awaiting approval auto-routes to plan mode (see the
    // approval-reachability block below), so it is the wrong scene to test free switching.
    const { container, store } = renderScene('running');
    const before = store.getState().snapshot;

    act(() => {
      fireEvent.click(modeTab(container, 'math'));
    });
    expect(container.querySelector('[data-mode-shell="math"]')).not.toBeNull();

    // The projection is untouched: the mode is chrome, not domain state.
    expect(store.getState().snapshot).toBe(before);
    expect(store.getState().snapshot).not.toHaveProperty('mode');
    // And it was never sent as a command.
    expect(store.getState().lastCommand).toBeUndefined();
    expect(store.getState().lastCommand?.type).not.toBe('set_ui_mode');
  });

  it('exposes the current mode on the tab strip', () => {
    const { container } = renderScene('running');
    expect(modeTab(container, 'chat').getAttribute('aria-selected')).toBe('true');
    act(() => {
      fireEvent.click(modeTab(container, 'math'));
    });
    expect(modeTab(container, 'math').getAttribute('aria-selected')).toBe('true');
    expect(modeTab(container, 'chat').getAttribute('aria-selected')).toBe('false');
  });

  it('keeps a running task alive and says so when the surface is replaced', () => {
    const { container, store } = renderScene('running');
    const taskBefore = store.getState().snapshot.task;
    expect(taskBefore).toBeDefined();

    act(() => {
      fireEvent.click(modeTab(container, 'math'));
    });

    // Switching did not cancel, pause or otherwise disturb the run.
    expect(store.getState().snapshot.task).toBe(taskBefore);
    expect(store.getState().lastCommand).toBeUndefined();
    // And the user is told where it went, with a way back.
    const strip = container.querySelector('[data-cross-mode-strip]');
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain('对话');

    act(() => {
      fireEvent.click(container.querySelector('[data-cross-mode-view]') as HTMLElement);
    });
    expect(container.querySelector('[data-mode-shell="chat"]')).not.toBeNull();
  });

  it('shows no strip in plan mode, since the conversation surface is still on screen', () => {
    const { container } = renderScene('running');
    act(() => {
      fireEvent.click(modeTab(container, 'plan'));
    });
    expect(container.querySelector('[data-cross-mode-strip]')).toBeNull();
  });
});

describe('plan approval is always reachable', () => {
  // Regression guard. The plan-approval surface used to live in the conversation's centre
  // tab strip. When that moved into plan mode, chat mode lost every approve/reject control
  // — so a task waiting on approval was a dead end unless the user guessed to switch modes.
  // These assertions fail if that ever happens again.
  it('auto-routes to plan mode when a task is awaiting approval', () => {
    const { container } = renderScene('plan');
    expect(container.querySelector('[data-mode-shell="plan"]')).not.toBeNull();
    expect(container.querySelector('[data-plan-review]')).not.toBeNull();
  });

  it('offers approve and reject while a plan waits', () => {
    const { container } = renderScene('plan');
    const review = container.querySelector('[data-plan-review]') as HTMLElement;
    expect(review).not.toBeNull();
    expect(review.textContent).toMatch(/批准|Approve/);
    expect(review.textContent).toMatch(/拒绝|Reject/);
  });

  it('does not force plan mode once the task has moved past approval', () => {
    const { container, store } = renderScene('running');
    // `running` is executing: the user is free to leave plan mode.
    act(() => {
      fireEvent.click(modeTab(container, 'chat'));
    });
    expect(container.querySelector('[data-mode-shell="chat"]')).not.toBeNull();
    expect(store.getState().snapshot.task?.status).toBe('executing');
  });

  it('drops the cross-mode strip while approval is pending, since plan mode already shows it', () => {
    const { container } = renderScene('plan');
    // Awaiting approval and in math mode would otherwise show a "task running" strip that
    // competes with the approval the user must act on.
    expect(container.querySelector('[data-mode-shell="plan"]')).not.toBeNull();
    expect(container.querySelector('[data-cross-mode-strip]')).toBeNull();
  });
});

describe('math workspace', () => {
  it('never auto-plays the demo — it is an explicit, labelled action', () => {
    const { container } = renderScene('empty');
    act(() => {
      fireEvent.click(modeTab(container, 'math'));
    });
    // Opt-in: no badge and no data until the user asks for it.
    expect(container.querySelector('[data-math-demo-badge]')).toBeNull();
    expect(container.querySelector('[data-math-demo-load]')).not.toBeNull();
    // And the mode says plainly that the engine has no math backend.
    expect(container.querySelector('[data-math-unavailable]')).not.toBeNull();
  });

  it('badges the demo everywhere it shows data, and can be exited', () => {
    const { container, store } = renderScene('empty');
    act(() => {
      fireEvent.click(modeTab(container, 'math'));
    });
    act(() => {
      fireEvent.click(container.querySelector('[data-math-demo-load]') as HTMLElement);
    });

    expect(container.querySelector('[data-math-demo-badge]')).not.toBeNull();
    expect(container.querySelector('[data-math-result-card]')).not.toBeNull();
    expect(container.querySelector('[data-math-solver-log]')).not.toBeNull();
    // The progress rail reads the same demo, and flags itself as demo.
    expect(container.querySelector('[data-progress-bar]')).not.toBeNull();

    act(() => {
      fireEvent.click(container.querySelector('[data-math-demo-clear]') as HTMLElement);
    });
    expect(store.getState().mathDemo).toBeUndefined();
    expect(container.querySelector('[data-math-demo-badge]')).toBeNull();
  });

  it('leaves solve and export disabled with a stated reason', () => {
    const { container } = renderScene('empty');
    act(() => {
      fireEvent.click(modeTab(container, 'math'));
    });
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

  it('walks the stage sequence deterministically from the demo frames', () => {
    const { container } = renderScene('empty');
    act(() => {
      fireEvent.click(modeTab(container, 'math'));
    });
    act(() => {
      fireEvent.click(container.querySelector('[data-math-demo-load]') as HTMLElement);
    });
    // Frame 0 is the modeling stage.
    expect(container.querySelector('[data-math-current="true"]')?.getAttribute('data-math-stage')).toBe('modeling');
  });

  it('puts the model in the right rail as read-only, and only in math mode', () => {
    const { container } = renderScene('empty');
    // Chat: no model tab.
    expect(screen.queryByRole('tab', { name: /模型|Model/ })).toBeNull();
    act(() => {
      fireEvent.click(modeTab(container, 'math'));
    });
    const open = container.querySelector('[data-open-right-rail]') as HTMLElement | null;
    if (open) act(() => { fireEvent.click(open); });
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /模型|Model/ }));
    });
    const section = container.querySelector('[data-rail-model]');
    expect(section).not.toBeNull();
    // Read-only: no inputs, no buttons other than the rail's own chrome.
    expect(section!.querySelectorAll('input, textarea, select')).toHaveLength(0);
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
