/**
 * Run dock — TRAE-ish pill strip above the composer (F2).
 * Left third: thin overall progress; centre: lifecycle; right: run controls.
 * @module
 */

import type { ReactNode } from 'react';

import { LifecycleStepper } from '../modes/ModeHeader.js';
import { deriveProgress } from '../progress/deriveProgress.js';
import { useMode } from '../mode/useMode.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { RunControls } from './RunControls.js';

export function RunDock(): ReactNode {
  const { snapshot } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  const { mode } = useMode();
  if (!snapshot.task) return null;

  const result = deriveProgress({ task: snapshot.task, mode: mode === 'math' ? 'math' : 'work', language });
  const ratio =
    result.progress.kind === 'task'
      ? result.progress.ratio
      : result.progress.kind === 'math'
        ? result.progress.overall
        : result.progress.ratio;
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  const label =
    result.progress.kind === 'task' && result.progress.total > 0
      ? `${result.progress.current}/${result.progress.total}`
      : `${pct}%`;

  return (
    <div
      data-run-dock
      className="mx-4 mb-1.5 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center rounded-full border border-line bg-elevated/70 px-3 py-1 shadow-sm"
    >
      <div className="flex min-w-0 items-center gap-2 pr-2" data-run-dock-progress>
        <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-line/80" aria-hidden>
          <div
            className="h-full rounded-full bg-info transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-3">{label}</span>
      </div>
      <LifecycleStepper compact />
      <span className="flex min-w-0 justify-end">
        <RunControls />
      </span>
    </div>
  );
}
