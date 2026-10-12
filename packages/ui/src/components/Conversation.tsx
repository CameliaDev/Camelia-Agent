/**
 * Conversation column — the running record of the task.
 *
 * Reading order is deliberate: what the agent is doing now (activity bar), anything that
 * needs the user's judgement (notices, approvals, failures), then the task itself
 * (intent → steps → delivery). A task with no steps yet shows a real planning state, not
 * a spinner; a task with no task at all shows the empty state.
 * @module
 */

import { useState, type ReactNode } from 'react';

import type { Artifact, Id } from '@camelia/core';
import type { CheckpointView, NarrationView, TaskView, ToolCallView } from '@camelia/agent/view';

import { count, ms } from '../lib/format.js';
import { makeCommand } from '../state/store.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { t } from '../i18n/strings.js';
import { canIntervene, interveneUnavailableReason } from '../window/capabilities.js';
import { ActivityBar } from './ActivityBar.js';
import { ApprovalCard, FailureCard, NoticeBanner } from './Reliability.js';
import { StepCard } from './StepCard.js';
import { Avatar, Chip, ErrorState, Icon, LoadingState, SkeletonRows } from './primitives.js';

function ArtifactRow({ artifact }: { artifact: Artifact }): ReactNode {
  const icon = artifact.kind === 'diff' ? 'branch' : artifact.kind === 'stdout' ? 'terminal' : 'file';
  return (
    <li className="flex items-center gap-2 rounded-md border border-line bg-base/40 px-2 py-1.5">
      <Icon name={icon} size={13} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{artifact.path}</span>
      {artifact.hash ? <span className="shrink-0 font-mono text-[10px] text-ink-3">{artifact.hash}</span> : null}
      {artifact.sizeBytes !== undefined ? (
        <span className="shrink-0 font-mono text-[10px] text-ink-3">{count(artifact.sizeBytes)}B</span>
      ) : null}
    </li>
  );
}

/** The checkpoint a rollback would restore — the newest one at or before the current step. */
function rollbackTarget(task: TaskView): CheckpointView | undefined {
  const eligible = task.checkpoints.filter((c) => c.stepIdx <= task.currentStepIdx);
  return eligible[eligible.length - 1] ?? task.checkpoints[task.checkpoints.length - 1];
}

function IntentCard({ task }: { task: TaskView }): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const showAvatars = useUiStore((s) => s.localPrefs.showAvatars);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [showAssumptions, setShowAssumptions] = useState(false);
  return (
    <div className="flex items-start justify-end gap-2.5" data-message="user">
      <div className="max-w-[75%]">
        <div className="wf-bubble-user px-3.5 py-2.5">
          <p className="text-[13px] leading-6">{task.intentRaw}</p>
        </div>

        {task.goal && task.goal !== task.intentRaw ? (
          <p className="mt-1.5 text-[11.5px] leading-5 text-ink-2">
            <span className="text-ink-3">{tr('intent.restatedGoal')} · </span>
            {task.goal}
          </p>
        ) : null}

        {task.assumptions.length || task.constraints.length ? (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setShowAssumptions((v) => !v)}
              className="text-[10.5px] text-ink-3 hover:text-ink-2"
            >
              {showAssumptions ? '▾' : '▸'} {task.assumptions.length + task.constraints.length} {tr('intent.assumptions')}
            </button>
          </div>
        ) : null}

        {task.assumptions.length && showAssumptions ? (
          <div className="mt-1.5 flex flex-wrap justify-end gap-x-6 gap-y-1.5">
            <div className="min-w-0 text-right">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{tr('intent.assumptions')}</p>
              <ul className="mt-0.5 space-y-0.5">
                {task.assumptions.map((a) => (
                  <li key={a} className="text-[11.5px] text-ink-2">
                    {a} ·
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {task.interventions.length ? (
          <div className="mt-2.5 space-y-1 border-t border-line pt-2">
            {task.interventions.map((i, idx) => (
              <p key={idx} className="text-right text-[11.5px] text-info">
                {tr('intent.steered')} {i.newGoal}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      {showAvatars ? <Avatar kind="user" size={32} title={tr('avatar.user')} /> : null}
    </div>
  );
}

function DeliveryCard({ task }: { task: TaskView }): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const showAvatars = useUiStore((s) => s.localPrefs.showAvatars);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  return (
    <div className="flex items-start gap-2.5" data-message="agent">
      {showAvatars ? <Avatar kind="agent" size={32} title={tr('avatar.agent')} /> : null}
      <div className="min-w-0 flex-1 rounded-lg border border-ok/35 bg-ok/10 p-3">
      <div className="flex items-center gap-2">
        <Icon name="check" size={15} className="text-ok" />
        <span className="text-[12.5px] font-semibold text-ok">{tr('delivery.delivered')}</span>
        <Chip tone="ok">{task.steps.filter((s) => s.status === 'done').length}/{task.stepsTotal} {tr('step.done')}</Chip>
        <span className="ml-auto font-mono text-[10.5px] text-ink-3">{ms(task.updatedAt - task.startedAt)}</span>
      </div>
      {task.summary ? <p className="mt-2 text-[12px] leading-6 text-ink-2">{task.summary}</p> : null}
      {task.artifacts.length ? (
        <>
          <p className="mt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{tr('delivery.artifacts')}</p>
          <ul className="mt-1 space-y-1">
            {task.artifacts.map((a) => (
              <ArtifactRow key={a.path} artifact={a} />
            ))}
          </ul>
        </>
      ) : null}
      </div>
    </div>
  );
}

function TaskRecord({ task, onRollback }: { task: TaskView; onRollback: (stepIdx: number, stepId: Id) => void }): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const showAvatars = useUiStore((s) => s.localPrefs.showAvatars);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const toolsByStep = new Map<Id, ToolCallView[]>();
  for (const call of Object.values(task.toolCalls)) {
    const list = toolsByStep.get(call.stepId) ?? [];
    list.push(call);
    toolsByStep.set(call.stepId, list);
  }
  const narrationByStep = new Map<number, NarrationView[]>();
  for (const entry of task.narration) {
    const list = narrationByStep.get(entry.stepIdx) ?? [];
    list.push(entry);
    narrationByStep.set(entry.stepIdx, list);
  }

  const introNarration = (narrationByStep.get(-1) ?? []).filter(
    (n) => !n.text.trimStart().startsWith('{'),
  );
  const checkpoint = rollbackTarget(task);

  return (
    <div className="space-y-3">
      <IntentCard task={task} />

      {introNarration.length ? (
        <div className="flex items-start gap-2.5" data-message="agent">
          {showAvatars ? <Avatar kind="agent" size={32} title={tr('avatar.agent')} /> : null}
          <div className="max-w-[75%]">
            <div className="wf-bubble-agent px-3.5 py-2.5">
              {introNarration.map((n) => (
                <p key={n.id} className="text-[12.5px] leading-[1.7] text-ink">
                  {n.text}
                  {n.streaming ? <span className="camelia-pulse ml-0.5 inline-block h-3 w-1.5 translate-y-[1px] bg-accent align-middle" /> : null}
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {task.steps.length === 0 && task.status !== 'failed' && task.status !== 'cancelled' ? (
        <div className="rounded-lg border border-line bg-elevated/50 p-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-accent">
            <Icon name="layers" size={13} />
            {tr('step.drafting')}
          </div>
          <SkeletonRows rows={3} />
        </div>
      ) : (
        task.steps.map((step) => (
          <StepCard
            key={step.id}
            step={step}
            narration={narrationByStep.get(step.idx) ?? []}
            toolCalls={toolsByStep.get(step.id) ?? []}
            onRollback={
              checkpoint ? () => onRollback(checkpoint.stepIdx, checkpoint.id) : undefined
            }
          />
        ))
      )}

      {task.summary ? <DeliveryCard task={task} /> : null}
    </div>
  );
}

export function Conversation(): ReactNode {
  const { snapshot, status, transportError, lastCommandError, dispatch, activeSessionId } = useUiState();
  const clearCommandError = useUiStore((s) => s.clearCommandError);
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const rollbackOk = canIntervene('rollback_step');
  const degradeOk = canIntervene('select_provider');
  const [steering, setSteering] = useState(false);
  const [steerText, setSteerText] = useState('');
  const task = snapshot.task;


  const rollback = (stepIdx: number, checkpointId: Id): void => {
    void stepIdx;
    if (!canIntervene('rollback_step')) return;
    dispatch(makeCommand('rollback_step', { taskId: task?.id ?? '', checkpointId }));
  };

  if (transportError) {
    return <ErrorState title="The transport could not start" detail={transportError} />;
  }
  if (!task) {
    if (status === 'connecting') return <LoadingState />;
    const suggestions = [
      '排查线上 500 并给出复现步骤',
      '为模块补测试与验收清单',
      '梳理依赖并画出调用链',
    ];
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
        {/* Transitional brand mark. The name is deliberately not final here — see the
            plan book §10; what was removed is the orange "TBD" wireframe annotation,
            which read as a defect rather than as a placeholder. */}
        <div
          data-brand-mark
          className="grid h-20 w-20 place-items-center rounded-full border border-line bg-elevated/60 text-accent"
        >
          <Icon name="camellia" size={34} />
        </div>
        <p className="mt-3 text-[14px] font-semibold text-ink">{tr('brand.transition')}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">{tr('brand.placeholder.hint')}</p>

        <h2 className="mt-7 text-[17px] font-semibold text-ink">暂无任务</h2>
        <p className="mt-2 max-w-md text-[12.5px] leading-6 text-ink-3">
          描述你想构建、修复或调查的内容。Camelia 会规划、逐步执行、校验每个验收点，并向你展示完整运行过程。
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-full border border-line bg-base px-3 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
              onClick={() =>
                dispatch(makeCommand('submit_task', { sessionId: activeSessionId ?? 'ses_new', intent: s, workspace: snapshot.session?.workspace ?? '.' }))
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const checkpoint = rollbackTarget(task);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ActivityBar
        task={task}
        onPause={() => dispatch(makeCommand('pause_task', { taskId: task.id, reason: 'user paused' }))}
        onResume={() => dispatch(makeCommand('resume_task', { taskId: task.id }))}
        onCancel={() => dispatch(makeCommand('cancel_task', { taskId: task.id, reason: 'user cancelled' }))}
        onIntervene={() => setSteering((v) => !v)}
      />


      <div data-conversation className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {steering ? (
          <form
            className="rounded-lg border border-info/40 bg-info/10 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!steerText.trim()) return;
              dispatch(makeCommand('intervene_goal', { taskId: task.id, instruction: steerText.trim() }));
              setSteerText('');
              setSteering(false);
            }}
          >
            <p className="text-[11.5px] font-medium text-info">Steer the run — the goal is re-anchored, prior work is kept.</p>
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={steerText}
                onChange={(e) => setSteerText(e.target.value)}
                placeholder="e.g. also update the README, and skip the e2e suite"
                className="min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-info/60"
              />
              <button type="submit" className="rounded-md bg-info/80 px-2.5 py-1.5 text-[11.5px] font-medium text-base hover:bg-info">
                Send
              </button>
              <button
                type="button"
                onClick={() => setSteering(false)}
                className="rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-ink-2 hover:border-ink-3"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {lastCommandError ? (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn" data-command-error>
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 font-mono text-[11.5px]">
                {lastCommandError.type}: {lastCommandError.error}
              </span>
              <button type="button" className="shrink-0 text-[11px] underline" onClick={() => clearCommandError()}>
                {tr('commandError.dismiss')}
              </button>
            </div>
          </div>
        ) : null}

        {task.notices.length ? (
          <div className="space-y-2">
            {task.notices.map((notice, i) => (
              <NoticeBanner key={`${notice.kind}-${notice.at}-${i}`} notice={notice} />
            ))}
          </div>
        ) : null}

        {task.approvals.map((approval) => (
          <ApprovalCard
            key={approval.callId}
            approval={approval}
            onApprove={(scope) => dispatch(makeCommand('approve_tool', { callId: approval.callId, scope }))}
            onDeny={() => dispatch(makeCommand('deny_tool', { callId: approval.callId, reason: 'denied by the user' }))}
          />
        ))}

        {task.failures.length ? (
          <div className="space-y-2">
            {task.failures.map((failure, i) => (
              <FailureCard
                key={`${failure.at}-${i}`}
                failure={failure}
                checkpoint={checkpoint}
                canRollback={rollbackOk}
                canDegrade={degradeOk}
                rollbackUnavailableReason={interveneUnavailableReason('rollback_step') || tr('intervene.rollbackUnavailable')}
                degradeUnavailableReason={interveneUnavailableReason('select_provider') || tr('intervene.degradeUnavailable')}
                labels={{
                  recoverable: tr('failure.recoverable'),
                  exhausted: tr('failure.exhausted'),
                  attempts: tr('failure.attempts'),
                  strategy: tr('failure.strategy'),
                  suggested: tr('failure.suggested'),
                  checkpoint: tr('failure.checkpoint'),
                  retry: tr('failure.retry'),
                  degrade: tr('failure.degrade'),
                  rollback: tr('failure.rollback'),
                }}
                onRetry={() =>
                  dispatch(
                    makeCommand('intervene_goal', {
                      taskId: task.id,
                      instruction: 'Retry the failed step and report the new evidence.',
                    }),
                  )
                }
                onDegrade={() => {
                  if (!degradeOk) return;
                  dispatch(makeCommand('select_provider', { providerId: 'ollama', model: 'qwen2.5-coder:7b' }));
                }}
                onRollback={() => {
                  if (!rollbackOk || !checkpoint) return;
                  rollback(checkpoint.stepIdx, checkpoint.id);
                }}
              />
            ))}
          </div>
        ) : null}

        <TaskRecord task={task} onRollback={rollback} />

        {task.status === 'paused' ? (
          <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
            Paused — {task.pausedReason ?? 'no reason given'}. The last checkpoint is intact; resume picks up there.
          </p>
        ) : null}
        {task.status === 'cancelled' ? (
          <p className="rounded-lg border border-line bg-elevated/60 px-3 py-2 text-[12px] text-ink-2">
            {tr('cancelled.note')}
          </p>
        ) : null}
      </div>
    </div>
  );
}