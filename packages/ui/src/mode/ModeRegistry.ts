/**
 * Mode registry — Work | Math only (F6).
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
  {
    id: 'math',
    labelKey: 'mode.math',
    descriptionKey: 'mode.math.desc',
    icon: 'sigma',
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
