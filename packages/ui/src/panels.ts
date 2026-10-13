/**
 * The run-panel registry — the six panels, and nothing else.
 *
 * ## Why it is its own module
 *
 * The ids are needed in three places that must never disagree: the icon row in
 * `ModeHeader`, the deck that renders the bodies, and the store that remembers which one is
 * open. The store cannot import `RunPanels.tsx`, because that file imports the store — so a
 * registry living there would be a cycle, and a cycle resolved the wrong way is a
 * `undefined` at module-init time rather than an error.
 *
 * So this file holds no components and reads no state: it is data plus two pure functions.
 * Everything with behaviour lives in `RunPanels.tsx`.
 *
 * ## Why six panels and not six tabs
 *
 * These were the tabs of the right rail, which has been removed. The reasons are recorded
 * on `RunPanels.tsx`; the short version is that four of the six can only show something once
 * a task exists, so an idle window presented a 360px column of tabs leading to empty
 * panels. Icons in the mode header cost 24px each and are present in every mode.
 *
 * ## `needsTask` and `mathOnly`
 *
 * Both exist so the *emptiness* of the UI is computed from one table. A panel that needs a
 * task and has none still appears — dimmed, with a tooltip saying why — rather than
 * vanishing, because a control that disappears reads as a control that broke.
 * @module
 */

import type { t } from './i18n/strings.js';

export const PANEL_IDS = ['memory', 'events', 'run', 'context', 'sub', 'model'] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelSpec {
  readonly id: PanelId;
  /** Inline icon name, resolved by `primitives`'s `PATHS`. */
  readonly icon: string;
  /** Every label is translated, so the key is typed against the dictionary itself. */
  readonly labelKey: Parameters<typeof t>[1];
  /** Nothing to show until a task exists. Dimmed with a reason, never hidden. */
  readonly needsTask: boolean;
  /** Offered in math mode only — a read-only mirror of what the math workspace owns. */
  readonly mathOnly: boolean;
}

export const PANELS: readonly PanelSpec[] = [
  { id: 'memory', icon: 'star', labelKey: 'panel.memory', needsTask: false, mathOnly: false },
  { id: 'events', icon: 'terminal', labelKey: 'panel.events', needsTask: false, mathOnly: false },
  { id: 'run', icon: 'layers', labelKey: 'panel.run', needsTask: true, mathOnly: false },
  { id: 'context', icon: 'gauge', labelKey: 'panel.context', needsTask: true, mathOnly: false },
  { id: 'sub', icon: 'bot', labelKey: 'panel.sub', needsTask: true, mathOnly: false },
  { id: 'model', icon: 'sigma', labelKey: 'panel.model', needsTask: false, mathOnly: true },
];

/**
 * Kept beside the table so a consumer can be exhaustive: `Record<PanelId, …>` somewhere
 * downstream becomes a type error when a panel is added, rather than a silent fallthrough.
 */
export const PANEL_ID_SET: ReadonlySet<PanelId> = new Set(PANEL_IDS);

/** The panels offered in a given mode, in header order. */
export function panelsForMode(mode: 'chat' | 'plan' | 'math'): PanelSpec[] {
  return PANELS.filter((p) => !p.mathOnly || mode === 'math');
}

/** Whether a panel needs a task before it has anything to show. */
export function panelNeedsTask(id: PanelId): boolean {
  return PANELS.find((p) => p.id === id)?.needsTask ?? false;
}

/**
 * Whether an id is still offered in a mode.
 *
 * Used when the mode changes under an open panel: switching from math to chat while the
 * model panel is open would otherwise leave the deck rendering a panel whose icon the
 * header no longer shows — an open body with no way to close it.
 */
export function panelAvailableIn(id: PanelId, mode: 'chat' | 'plan' | 'math'): boolean {
  return panelsForMode(mode).some((p) => p.id === id);
}