/**
 * Team orchestration surface — shared by Work (primary) and Term (legacy chrome).
 *
 * Reads the engine task projection only; does not advance phases locally.
 * @module
 */

import type { ReactNode } from 'react';

import type { TaskView } from '@camelia/agent/view';

import { t } from '../../i18n/strings.js';
import { useUiStore } from '../../state/UiProvider.js';
import { makeCommand } from '../../state/store.js';
import { termPhaseFromTask, type TermPhase } from '../term/term-phase.js';

const PHASES: readonly Exclude<TermPhase, 'failed'>[] = ['plan', 'execute', 'verify', 'done'];

export function TeamOrchestrationCard({ task }: { task: TaskView }): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const dispatch = useUiStore((s) => s.dispatch);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  const phase = termPhaseFromTask(task);
  const failure = task.failures[task.failures.length - 1];

  return (
    <section
      className="rounded-xl border border-line bg-elevated/40 px-4 py-3"
      data-team-orchestration
      data-term-timeline
    >
      <header className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{tr('team.title')}</p>
        {phase ? (
          <span className="font-mono text-[10px] text-ink-3" data-term-phase={phase}>
            {tr(`term.${phase}` as Parameters<typeof t>[1])}
          </span>
        ) : null}
      </header>
      <ol className="mt-2 flex flex-wrap items-center gap-2" data-term-phases>
        {PHASES.map((id, index) => {
          const current = phase === id;
          const reached = phase ? phase !== 'failed' && PHASES.indexOf(phase) >= index : false;
          return (
            <li key={id} className="flex min-w-0 items-center gap-2">
              <span
                data-term-step={id}
                data-term-current={current ? 'true' : undefined}
                className={`inline-flex items-center gap-1.5 text-[11.5px] ${
                  current ? 'font-medium text-ink' : reached ? 'text-ink-2' : 'text-ink-3'
                }`}
              >
                <span className="font-mono text-[10px]">{index + 1}</span>
                {tr(`term.${id}` as Parameters<typeof t>[1])}
              </span>
              {index < PHASES.length - 1 ? <span className="text-ink-3/50">·</span> : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-3" data-term-run data-term-phase={phase ?? undefined}>
        <p className="text-[13.5px] leading-6 text-ink">{task.goal ?? task.intentRaw}</p>
        {phase ? (
          <p className="mt-1.5 text-[12px] leading-5 text-ink-3">
            {tr(`term.phase.${phase}` as Parameters<typeof t>[1])}
          </p>
        ) : null}
        {phase === 'failed' && failure ? (
          <p className="mt-2 text-[12px] leading-5 text-bad" data-term-failure>
            {failure.reason}
          </p>
        ) : null}
        {task.status === 'awaiting-approval' ? (
          <div className="mt-3 flex gap-2" data-term-approval>
            <button
              type="button"
              className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white"
              onClick={() => dispatch(makeCommand('approve_plan', { taskId: task.id, scope: 'once' }))}
            >
              {tr('approval.once')}
            </button>
            <button
              type="button"
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink"
              onClick={() => dispatch(makeCommand('reject_plan', { taskId: task.id, reason: 'rejected' }))}
            >
              {tr('approval.reject')}
            </button>
          </div>
        ) : null}
        {task.subAgents.length > 0 ? (
          <ul className="mt-3 space-y-2" data-term-workers>
            {task.subAgents.map((agent) => (
              <li
                key={agent.id}
                data-term-worker={agent.id}
                data-term-worker-status={agent.status}
                className="text-[12px] leading-5"
              >
                <span className="font-medium text-ink-2">
                  {agent.role ? `${agent.role} · ` : ''}
                  {agent.status === 'ok'
                    ? tr('term.worker.ok')
                    : agent.status === 'error'
                      ? tr('term.worker.error')
                      : tr('term.worker.running')}
                </span>
                <span className="mt-0.5 block text-ink">{agent.goal}</span>
                {agent.model ? <span className="block font-mono text-[11px] text-ink-3">{agent.model}</span> : null}
                {agent.summary ? <span className="block text-ink-3">{agent.summary}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** Whether Work should show the team card (term session only — avoids duplicating TaskRunCard). */
export function taskShowsTeamOrchestration(task: TaskView | undefined, sessionKind?: string): boolean {
  if (!task || sessionKind !== 'term') return false;
  return true;
}
