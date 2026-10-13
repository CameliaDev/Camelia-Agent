/**
 * The run-panel registry — panels opened into the right rail (F3).
 * @module
 */

import type { t } from './i18n/strings.js';
import type { AppModeId } from './mode/types.js';

export const PANEL_IDS = ['run', 'artifacts', 'memory', 'context', 'events', 'sub', 'model'] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelSpec {
  readonly id: PanelId;
  readonly icon: string;
  readonly labelKey: Parameters<typeof t>[1];
  readonly needsTask: boolean;
  readonly mathOnly: boolean;
}

export const PANELS: readonly PanelSpec[] = [
  { id: 'run', icon: 'layers', labelKey: 'panel.run', needsTask: true, mathOnly: false },
  { id: 'artifacts', icon: 'file', labelKey: 'panel.artifacts', needsTask: true, mathOnly: false },
  { id: 'memory', icon: 'star', labelKey: 'panel.memory', needsTask: false, mathOnly: false },
  { id: 'context', icon: 'gauge', labelKey: 'panel.context', needsTask: true, mathOnly: false },
  { id: 'events', icon: 'terminal', labelKey: 'panel.events', needsTask: false, mathOnly: false },
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
