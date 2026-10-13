/**
 * Run dock — TRAE-ish pill strip above the composer (F2).
 * @module
 */

import type { ReactNode } from 'react';

import { LifecycleStepper } from '../modes/ModeHeader.js';
import { useUiState } from '../state/UiProvider.js';
import { RunControls } from './RunControls.js';

export function RunDock(): ReactNode {
  const { snapshot } = useUiState();
  if (!snapshot.task) return null;

  return (
    <div
      data-run-dock
      className="mx-4 mb-1.5 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center rounded-full border border-line bg-elevated/70 px-3 py-1 shadow-sm"
    >
      <span aria-hidden className="min-w-0" />
      <LifecycleStepper compact />
      <span className="flex min-w-0 justify-end">
        <RunControls />
      </span>
    </div>
  );
}
