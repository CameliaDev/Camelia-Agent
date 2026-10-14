/**
 * Term (团队模式) — legacy full-page chrome; prefer Work + team toggle (stage 20).
 * @module
 */

import type { ReactNode } from 'react';

import type { TaskView } from '@camelia/agent/view';

import { t } from '../../i18n/strings.js';
import { useUiStore } from '../../state/UiProvider.js';
import { TeamOrchestrationCard } from '../team/TeamOrchestrationCard.js';

export function TermWorkspace(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const session = useUiStore((s) => s.snapshot.session);
  const task = useUiStore((s) => s.snapshot.task);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  const termTask: TaskView | undefined =
    session?.kind === 'term' && task && task.sessionId === session.id ? task : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-term-workspace data-term-legacy>
      <p className="mx-auto w-full max-w-xl px-6 pt-6 text-[11.5px] text-ink-3" data-term-deprecated-banner>
        {tr('mode.term.deprecated')}
      </p>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-4" data-term-timeline>
        {termTask ? (
          <TeamOrchestrationCard task={termTask} />
        ) : (
          <p className="mt-2 max-w-md text-[13px] leading-6 text-ink-3" data-term-empty>
            {tr('term.empty')}
          </p>
        )}
      </div>
    </div>
  );
}
