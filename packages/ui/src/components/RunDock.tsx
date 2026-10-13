/**
 * Run dock — the strip directly above the composer.
 *
 * ## What lives here, and why
 *
 * Two things a reader needs while a run is in flight, on one line: the lifecycle stepper
 * (起草中 → 等待你的审批 → 执行中 → 已完成) centred, and the run controls — pause, steer,
 * stop — right-aligned. Both moved here from the mode header for the same reason: the run
 * is read and intervened at the bottom of the window, next to the composer, not 33px from
 * the top edge. The header keeps what does not change mid-run: the session title and the
 * panel icons.
 *
 * ## Layout
 *
 * A `1fr auto 1fr` grid: the empty left track counterweights the controls on the right, so
 * the stepper stays truly centred no matter how wide the control group grows.
 *
 * With no task there is nothing to run and nowhere to steer, and four empty stops would
 * claim otherwise — the dock renders nothing at all, exactly as its two children do.
 * @module
 */

import type { ReactNode } from 'react';

import { LifecycleStepper } from '../modes/ModeHeader.js';
import { useUiState } from '../state/UiProvider.js';
import { RunControls } from './RunControls.js';

export function RunDock(): ReactNode {
  const { snapshot } = useUiState();
  // The dock is a fact about the run; with no run it leaves no row behind.
  if (!snapshot.task) return null;

  return (
    <div data-run-dock className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4 pb-1.5">
      <span aria-hidden className="min-w-0" />
      <LifecycleStepper />
      <span className="flex min-w-0 justify-end">
        <RunControls />
      </span>
    </div>
  );
}
