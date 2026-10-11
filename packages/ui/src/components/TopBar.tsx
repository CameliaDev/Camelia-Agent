/**
 * Top bar — brand, phase, connection. Hidden until the pointer enters the top
 * hot zone, or until Ctrl+` . Session title and provider live on the right rail.
 * @module
 */

import type { ReactNode } from 'react';

import { CONNECTION_META, PHASE_META, TONE_TEXT } from '../lib/status.js';
import { useUiState } from '../state/UiProvider.js';
import { isTauri, windowClose, windowMinimize, windowStartDragging, windowToggleMaximize } from '../window/shell.js';
import { t } from '../i18n/strings.js';
import { Icon, StatusDot } from './primitives.js';

export function TopBar({ revealed }: { revealed: boolean }): ReactNode {
  const { snapshot, status, localPrefs } = useUiState();
  const task = snapshot.task;
  const phase = task ? PHASE_META[task.phase] : undefined;
  const connection = CONNECTION_META[status];
  const desktop = isTauri();
  const tr = (k: Parameters<typeof t>[1]) => t(localPrefs.language, k);
  const provider = snapshot.provider.activeProvider;

  const onMouseDown = (event: React.MouseEvent<HTMLElement>): void => {
    // Let buttons handle their own clicks; drag everything else on the bar.
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.button !== 0) return;
    void windowStartDragging();
  };

  return (
    <header
      className={`camelia-topbar absolute inset-x-0 top-0 z-40 flex h-9 items-center gap-3 border-b border-line bg-elevated px-3 ${
        revealed ? 'translate-y-0' : 'pointer-events-none -translate-y-full'
      }`}
      data-tauri-drag-region
      onMouseDown={onMouseDown}
      aria-hidden={revealed ? undefined : true}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-accent"
          title="Warm intelligence, sharp code."
        >
          <Icon name="camellia" size={15} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-ink">Camelia</span>
      </div>

      <span className="h-5 w-px bg-line" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {phase ? (
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${TONE_TEXT[phase.tone]}`}>
            <StatusDot tone={phase.tone} pulse={task?.phase === 'executing' || task?.phase === 'planning'} />
            {phase.label}
          </span>
        ) : (
          <span className="text-[12px] text-ink-3">{tr('status.noSession')}</span>
        )}
        {provider ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-ink-3" title={snapshot.provider.activeModel}>
            <Icon name="layers" size={11} />
            <span className="truncate font-mono">{provider}</span>
          </span>
        ) : status === 'connecting' ? (
          <span className="text-[11px] text-ink-3">{tr('provider.connecting')}</span>
        ) : null}
      </div>

      <span className={`flex items-center gap-1.5 text-[11px] font-medium ${TONE_TEXT[connection.tone]}`}>
        <StatusDot tone={connection.tone} pulse={status === 'live' || status === 'connecting'} />
        <span className="sr-only">{connection.label}</span>
      </span>

      {desktop ? (
        <div className="ml-2 flex items-center">
          <button type="button" aria-label="Minimize" className="grid h-8 w-10 place-items-center text-ink-2 hover:bg-hover" onClick={() => void windowMinimize()}>
            <Icon name="minimize" size={14} />
          </button>
          <button type="button" aria-label="Maximize" className="grid h-8 w-10 place-items-center text-ink-2 hover:bg-hover" onClick={() => void windowToggleMaximize()}>
            <Icon name="maximize" size={12} />
          </button>
          <button type="button" aria-label="Close" className="grid h-8 w-10 place-items-center text-ink-2 hover:bg-bad hover:text-white" onClick={() => void windowClose()}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : null}
    </header>
  );
}
