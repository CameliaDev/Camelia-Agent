/**
 * Term (团队模式) — plan, execute, verify.
 *
 * The timeline is local. Sending from the composer starts a pass on the term
 * session; the engine does not orchestrate a team yet, and this surface does
 * not pretend that it does.
 * @module
 */

import { useEffect, type ReactNode } from 'react';

import { t } from '../../i18n/strings.js';
import { advanceTermRun, useTermRun, type TermPhase } from '../../state/shell-extras.js';
import { useUiStore } from '../../state/UiProvider.js';

const PHASES: readonly TermPhase[] = ['plan', 'execute', 'verify', 'done'];

const PHASE_MS = 900;

export function TermWorkspace(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const run = useTermRun();

  useEffect(() => {
    if (!run || run.phase === 'done') return;
    const timer = window.setTimeout(() => advanceTermRun(), PHASE_MS);
    return () => window.clearTimeout(timer);
  }, [run]);

  const phase = run?.phase;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-term-workspace>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-8" data-term-timeline>
        <ol className="flex items-center gap-2" data-term-phases>
          {PHASES.map((id, index) => {
            const current = phase === id;
            const reached = phase ? PHASES.indexOf(phase) >= index : false;
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
        {run ? (
          <div className="mt-6" data-term-run data-term-phase={run.phase}>
            <p className="text-[14px] leading-6 text-ink">{run.intent}</p>
            <p className="mt-2 text-[12.5px] leading-5 text-ink-3">
              {tr(`term.phase.${run.phase}` as Parameters<typeof t>[1])}
            </p>
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
