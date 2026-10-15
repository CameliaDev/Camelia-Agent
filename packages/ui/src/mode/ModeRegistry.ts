/**
 * Mode registry — built-in workbench modes shown in settings.
 *
 * Math is an optional shell plugin (`math-mode`). Term is legacy engine surface only.
 * @module
 */

import { type AppModeId, type ModeDefinition } from './types.js';

export const MODE_REGISTRY: readonly ModeDefinition[] = [
  {
    id: 'work',
    labelKey: 'mode.work',
    descriptionKey: 'mode.work.desc',
    icon: 'bot',
    available: true,
  },
];

export function modeDefinition(id: AppModeId): ModeDefinition {
  const found = MODE_REGISTRY.find((mode) => mode.id === id);
  return found ?? MODE_REGISTRY[0]!;
}

/** Reserved future modes — not shown in the top-bar segmented control. */
export const MODE_COMING_SOON: readonly { labelKey: string; icon: string }[] = [
  { labelKey: 'mode.eval', icon: 'gauge' },
  { labelKey: 'mode.teach', icon: 'eye' },
];
