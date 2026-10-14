/**
 * Term (团队模式) — plan, execute, verify, done.
 *
 * The stages are the engine task. Sending `submit_term` starts a coordinator
 * and workers; this view only reads the projected task. It does not advance
 * itself on a timer, and it does not show done when no worker succeeded.
 * @module
 */

import type { ReactNode } from 'react';

import type { TaskView } from '@camelia/agent/view';

import { t } from '../../i18n/strings.js';
import { useUiStore } from '../../state/UiProvider.js';
import { makeCommand } from '../../state/store.js';
import { termPhaseFromTask, type TermPhase } from './term-phase.js';

const PHASES: readonly Exclude<TermPhase, 'failed'>[] = ['plan', 'execute', 'verify', 'done'];

export function TermWorkspace(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const dispatch = useUiStore((s) => s.dispatch);
  const session = useUiStore((s) => s.snapshot.session);
  const task = useUiStore((s) => s.snapshot.task);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  const termTask: TaskView | undefined =
    session?.kind === 'term' && task && task.sessionId === session.id ? task : undefined;
  const phase = termPhaseFromTask(termTask);
  const failure = termTask?.failures[termTask.failures.length - 1];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-term-workspace>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-8" data-term-timeline>
        <ol className="flex items-center gap-2" data-term-phases>
          {PHASES.map((id, index) => {
            const current = phase === id;
            const reached = phase ? phase !== 'failed' && PHASES.indexOf(phase) >= index : false;
            return (
              <li key={id} className="flex min-w-0 items-center gap-2">
                <span
                  data-term-step={id}
                  data-term-current={current ? 'true' : undefined}
                  className={`inline-flex items-center gap-1.5 text-[12.5px] ${
                    current ? 'font-medium text-ink' : reached ? 'text-ink-2' : 'text-ink-3'
                  }`}
                >
                  <span className="font-mono text-[10px]">{index + 1}</span>
                  {tr(`term.${id}` as Parameters<typeof t>[1])}
                </span>
                {index < PHASES.length - 1 ? <span className="text-ink-3/50">—</span> : null}
              </li>
            );
          })}
        </ol>
        {termTask && phase ? (
          <div className="mt-6" data-term-run data-term-phase={phase}>
            <p className="text-[14px] leading-6 text-ink">{termTask.goal ?? termTask.intentRaw}</p>
            <p className="mt-2 text-[12.5px] leading-5 text-ink-3">
              {tr(`term.phase.${phase}` as Parameters<typeof t>[1])}
            </p>
            {phase === 'failed' && failure ? (
              <p className="mt-2 text-[12.5px] leading-5 text-bad" data-term-failure>
                {failure.reason}
              </p>
            ) : null}
            {termTask.status === 'awaiting-approval' ? (
              <div className="mt-3 flex gap-2" data-term-approval>
                <button
                  type="button"
                  className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white"
                  onClick={() => dispatch(makeCommand('approve_plan', { taskId: termTask.id, scope: 'once' }))}
                >
                  {tr('approval.once')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink"
                  onClick={() => dispatch(makeCommand('reject_plan', { taskId: termTask.id, reason: 'rejected' }))}
                >
                  {tr('approval.reject')}
                </button>
              </div>
            ) : null}
            {termTask.subAgents.length > 0 ? (
              <ul className="mt-4 space-y-2" data-term-workers>
                {termTask.subAgents.map((agent) => (
                  <li key={agent.id} data-term-worker={agent.id} data-term-worker-status={agent.status} className="text-[12.5px] leading-5">
                    <span className="font-medium text-ink-2">
                      {agent.role ? `${agent.role} · ` : ''}
                      {agent.status === 'ok' ? tr('term.worker.ok') : agent.status === 'error' ? tr('term.worker.error') : tr('term.worker.running')}
                    </span>
                    <span className="mt-0.5 block text-ink">{agent.goal}</span>
                    {agent.model ? <span className="block font-mono text-[11px] text-ink-3">{agent.model}</span> : null}
                    {agent.summary ? <span className="block text-ink-3">{agent.summary}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="mt-6 max-w-md text-[13px] leading-6 text-ink-3" data-term-empty>
            {tr('term.empty')}
          </p>
        )}
      </div>
    </div>
  );
}
