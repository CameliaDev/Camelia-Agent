/**
 * Term (团队模式) — UI MVP stub.
 *
 * Switches and creates `term` sessions; orchestration backend is not wired yet.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../../i18n/strings.js';
import { useUiStore } from '../../state/UiProvider.js';
import { ModeHeader } from '../ModeHeader.js';

export function TermWorkspace(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-term-workspace>
      <ModeHeader
        leading={
          <span className="shrink-0 text-[11px] font-medium text-ink-2">{tr('mode.term')}</span>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10">
        <p className="max-w-md text-center text-[14px] font-medium text-ink">{tr('mode.term')}</p>
        <p className="max-w-md text-center text-[12.5px] leading-5 text-ink-3">{tr('mode.term.stub')}</p>
      </div>
    </div>
  );
}
