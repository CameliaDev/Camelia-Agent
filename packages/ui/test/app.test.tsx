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

import { act, fireEvent, render, screen } from '@testing-library/react';
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
  return { ...view, store, transport };
}

function expandRightRail(container: HTMLElement): void {
  const open = container.querySelector('[data-open-right-rail]') as HTMLElement | null;
  if (open) fireEvent.click(open);
}


// ---------------------------------------------------------------------------
// layout contract (§6.4 grid)
// ---------------------------------------------------------------------------

describe('App — layout contract', () => {
  // Behavior evolution (Iteration 23): rail widths are CSS variables, not static
  // Tailwind classes, so a drag can change them. Defaults stay 260px and 360px.
  // The top bar is an overlay (`h-9`) and pinned visible by default.
  it('renders the top bar and default rail widths from CSS variables', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');
    expect(container.querySelector('.h-9')).not.toBeNull();
    const shell = container.querySelector('[data-shell]') as HTMLElement;
    expect(shell.style.getPropertyValue('--rail-left-w')).toBe('260px');
    // wireframe v2: right data rail starts collapsed (48px strip)
    expect(shell.style.getPropertyValue('--rail-right-w')).toBe('48px');
    expect(container.querySelector('[data-rail="left"]')).not.toBeNull();
    expect(container.querySelector('[data-rail="right"]')).not.toBeNull();
    expect(container.querySelector('[data-rail-collapsed="true"]')).not.toBeNull();
    // left divider only while right is collapsed
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(container.querySelector('[data-open-right-rail]')).not.toBeNull();
  });

  it('hides Memory when collapsed and shows it after expand — even with sticky expanded prefs', () => {
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        version: 3,
        leftWidth: 260,
        rightWidth: 360,
        leftCollapsed: false,
        rightCollapsed: false,
        userSetRightRail: true,
        themeId: 'light',
        language: 'zh',
        topBar: 'pinned',
        motion: 'system',
        fontMono: '',
        planApproval: 'always',
      }),
    );
    const { container } = renderScene('empty');
    expect(container.querySelector('[data-rail-collapsed="true"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-panel"]')).toBeNull();
    expect(screen.queryByText('记忆')).not.toBeInTheDocument();
    expandRightRail(container);
    expect(container.querySelector('[data-rail-collapsed="false"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-panel"]')).not.toBeNull();
    expect(screen.getByText('记忆')).toBeInTheDocument();
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
// empty / loading
// ---------------------------------------------------------------------------

describe('App — wireframe v2 chrome', () => {
  it('shows circular message avatars and opens settings from the account entry', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('running');
    expect(container.querySelector('[data-message="user"] [data-avatar="user"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-avatar="agent"]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
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
    expect(screen.getByText('此工作区还没有会话。')).toBeInTheDocument();
    expect(screen.getByText('每完成一步后会出现恢复点。')).toBeInTheDocument();
  });

  it('refuses a typed task instead of attaching the demo plan', () => {
    renderScene('empty');
    fireEvent.change(screen.getByPlaceholderText(/描述一个任务/), { target: { value: '写一个 hello' } });
    fireEvent.click(screen.getByRole('button', { name: '运行' }));
    expect(screen.queryByText('定位 CLI 入口和报告生成器')).not.toBeInTheDocument();
    expect(screen.getByText(/未连接引擎/)).toBeInTheDocument();
  });

  it('offers connection presets in multi-section settings', () => {
    localStorage.removeItem('camelia.localPrefs');
    const { container } = renderScene('empty');
    expect(container.querySelector('[data-account-entry]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
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
    expandRightRail(container);
    expect(screen.getByText('No plan yet — the planner has not returned.')).toBeInTheDocument();
  });

  it('exposes the task phase', () => {
    renderScene('planning');
    expect(screen.getAllByText('Planning').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// running — the core architecture surface
// ---------------------------------------------------------------------------

describe('App — running scene exposes the whole run', () => {
  it('shows the agent phase and activity', () => {
    renderScene('running');
    expect(screen.getAllByText('Executing').length).toBeGreaterThan(0);
  });

  it('shows the step list with per-step status', () => {
    const { container } = renderScene('running');
    expandRightRail(container);
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

  it('shows current step and progress percentage', () => {
    renderScene('running');
    expect(screen.getByText(/step \d+\/5/)).toBeInTheDocument();
  });

  it('shows tool calls with their names and durations', () => {
    renderScene('running');
    expect(screen.getAllByText('fs.read').length).toBeGreaterThan(0);
    expect(screen.getAllByText('fs.edit').length).toBeGreaterThan(0);
  });

  it('shows context usage as tokens and a window share', () => {
    const { container } = renderScene('running');
    expandRightRail(container);
    expect(screen.getAllByText('上下文').length).toBeGreaterThan(0);
    expect(screen.getByText(/\/ .* tokens/)).toBeInTheDocument();
  });

  it('lets the user inspect what compaction dropped', () => {
    const { container } = renderScene('running');
    expandRightRail(container);
    expect(screen.getByText('1 compaction')).toBeInTheDocument();
    expect(screen.getByText(/located the CLI entrypoint/)).toBeInTheDocument();
    expect(screen.getByText('protected slots that survived')).toBeInTheDocument();
  });

  it('shows the original text of the messages compaction dropped', () => {
    const { container } = renderScene('running');
    expandRightRail(container);
    expect(screen.getByText('dropped originals')).toBeInTheDocument();
    // The raw text of a dropped tool call, not just its one-line summary.
    expect(screen.getByText(/export function main\(argv: string\[\]\): number/)).toBeInTheDocument();
    expect(screen.getByText(/> node --version/)).toBeInTheDocument();
    // 12 kept originals out of the 12 the event reported.
    expect(screen.getByText('12/12')).toBeInTheDocument();
  });

  it('shows the sub-agent that ran in isolation', () => {
    const { container } = renderScene('running');
    expandRightRail(container);
    expect(screen.getByText('子代理')).toBeInTheDocument();
    expect(screen.getByText(/Locate the format switch/)).toBeInTheDocument();
  });

  it('offers pause, steer and cancel controls', () => {
    renderScene('running');
    expect(screen.getAllByText(/^Pause$|^暂停$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Steer$|^引导$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Cancel$|^取消$/).length).toBeGreaterThan(0);
  });

  it('keeps the raw event trail for audit', () => {
    const { container } = renderScene('running');
    expandRightRail(container);
    expect(screen.getAllByText(/^Events$|^事件$/).length).toBeGreaterThan(0);
    // The trail ships collapsed (the rail must not drown the run in raw events); the
    // section header is the affordance that opens it.
    fireEvent.click(screen.getByLabelText('Expand events'));
    expect(screen.getAllByText('step.started').length).toBeGreaterThan(0);
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
    expect(screen.getAllByText(/Waiting for you|等待你的审批/).length).toBeGreaterThan(0);
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
    expect(screen.getByText('Failure — recoverable')).toBeInTheDocument();
    expect(screen.getByText('attempts')).toBeInTheDocument();
    expect(screen.getByText('strategy')).toBeInTheDocument();
  });

  it('offers retry, degrade and rollback', () => {
    renderScene('failure');
    expect(screen.getByText('Retry the step')).toBeInTheDocument();
    expect(screen.getByText('Fall back to a smaller model')).toBeInTheDocument();
    expect(screen.getByText('Roll back')).toBeInTheDocument();
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
    expect(screen.getAllByText(/Your request|用户提问/).length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getAllByText(/^Pause$|^暂停$/)[0]!);
    expect(store.getState().snapshot.task!.status).toBe('paused');
    expect(screen.getAllByText(/Paused — user paused|已暂停 — user paused/).length).toBeGreaterThan(0);
  });

  it('steer reveals the re-anchor input', () => {
    renderScene('running');
    fireEvent.click(screen.getAllByText(/^Steer$|^引导$/)[0]!);
    expect(screen.getAllByText(/Steer the run — the goal is re-anchored|引导本次运行/).length).toBeGreaterThan(0);
  });

  it('rollback from a step emits a recovery notice', () => {
    renderScene('done');
    fireEvent.click(screen.getAllByText(/roll back|回滚/)[0]!);
    expect(screen.getByText('Rollback complete')).toBeInTheDocument();
  });
});
