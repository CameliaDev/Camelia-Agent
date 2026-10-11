/**
 * Top bar — brand, phase, connection. Hidden until the pointer enters the top
 * hot zone, or until Ctrl+` . Session title and provider live on the right rail.
 * @module
 */

import type { ReactNode } from 'react';

import { CONNECTION_META, PHASE_META, TONE_TEXT } from '../lib/status.js';
import { useUiState } from '../state/UiProvider.js';
import { isTauri, windowClose, windowMinimize, windowToggleMaximize } from '../window/shell.js';
import { Icon, StatusDot } from './primitives.js';

export function TopBar({ revealed }: { revealed: boolean }): ReactNode {
  const { snapshot, status } = useUiState();
  const task = snapshot.task;
  const phase = task ? PHASE_META[task.phase] : undefined;
  const connection = CONNECTION_META[status];
  const desktop = isTauri();

  return (
    <header
      className={`camelia-topbar absolute inset-x-0 top-0 z-40 flex h-12 items-center gap-3 border-b border-line bg-elevated px-3 ${
        revealed ? 'translate-y-0' : 'pointer-events-none -translate-y-full'
      }`}
      data-tauri-drag-region
      aria-hidden={revealed ? undefined : true}
    >
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <span
          className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-accent"
          title="Warm intelligence, sharp code."
        >
          <Icon name="camellia" size={15} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-ink">Camelia</span>
      </div>

      <span className="h-5 w-px bg-line" />

      <div className="flex min-w-0 flex-1 items-center gap-2" data-tauri-drag-region>
        {phase ? (
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${TONE_TEXT[phase.tone]}`}>
            <StatusDot tone={phase.tone} pulse={task?.phase === 'executing' || task?.phase === 'planning'} />
            {phase.label}
          </span>
        ) : (
          <span className="text-[12px] text-ink-3">No task</span>
        )}
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
