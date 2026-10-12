/**
 * The mode registry.
 *
 * Adding a mode is *one entry here* plus an i18n pair plus a workspace branch — the
 * shell, the tabs and the progress derivation all read this table rather than
 * hard-coding three cases. That is the whole point: "more modes" is a data change,
 * not a chrome rewrite.
 *
 * `available` mirrors the honesty rule used by `window/capabilities.ts`: a mode whose
 * backend surface does not exist yet stays *visible* (so the IA is discoverable) but
 * declares itself unavailable, and its workspace shows a real explanation instead of a
 * fake one. Never flip this to `true` to make a screenshot look better.
 * @module
 */

import { type AppModeId, type ModeDefinition } from './types.js';

export const MODE_REGISTRY: readonly ModeDefinition[] = [
  {
    id: 'chat',
    labelKey: 'mode.chat',
    descriptionKey: 'mode.chat.desc',
    icon: 'bot',
    available: true,
  },
  {
    id: 'plan',
    labelKey: 'mode.plan',
    descriptionKey: 'mode.plan.desc',
    icon: 'compass',
    available: true,
  },
  {
    id: 'math',
    labelKey: 'mode.math',
    descriptionKey: 'mode.math.desc',
    icon: 'sigma',
    // The engine has no `math.*` commands yet (verified: EngineServer handles no math
    // case). The mode is therefore renderable — its panels, stage map and demo fixture
    // are real — but a *live* run cannot be started from here. Demo data is labelled.
    available: false,
    unavailableReasonKey: 'mode.math.unavailable',
  },
];

export function modeDefinition(id: AppModeId): ModeDefinition {
  const found = MODE_REGISTRY.find((mode) => mode.id === id);
  // The registry covers AppModeId exhaustively; this is a type-level guarantee that
  // degrades to the first entry rather than throwing in the UI.
  return found ?? MODE_REGISTRY[0]!;
}

/** Modes reserved for a future release — rendered disabled, never silently dropped. */
export const MODE_COMING_SOON: readonly { labelKey: string; icon: string }[] = [
  { labelKey: 'mode.eval', icon: 'gauge' },
  { labelKey: 'mode.teach', icon: 'eye' },
];
