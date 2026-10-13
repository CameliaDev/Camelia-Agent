/**
 * The run-panel registry — six panels opened into the right rail (F3).
 * @module
 */

import type { t } from './i18n/strings.js';
import type { AppModeId } from './mode/types.js';

export const PANEL_IDS = ['memory', 'events', 'run', 'context', 'sub', 'model'] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelSpec {
  readonly id: PanelId;
  readonly icon: string;
  readonly labelKey: Parameters<typeof t>[1];
  readonly needsTask: boolean;
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

export const PANEL_ID_SET: ReadonlySet<PanelId> = new Set(PANEL_IDS);

export function panelsForMode(mode: AppModeId): PanelSpec[] {
  return PANELS.filter((p) => !p.mathOnly || mode === 'math');
}

export function panelNeedsTask(id: PanelId): boolean {
  return PANELS.find((p) => p.id === id)?.needsTask ?? false;
}

export function panelAvailableIn(id: PanelId, mode: AppModeId): boolean {
  return panelsForMode(mode).some((p) => p.id === id);
}
