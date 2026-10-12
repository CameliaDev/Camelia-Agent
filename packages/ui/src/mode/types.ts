/**
 * Mode vocabulary — the front-end's top-level workbench selector.
 *
 * A mode is **chrome, not domain state**. `ProjectionSnapshot` is a single global
 * projection: all three modes read the *same* `task`. Switching modes therefore never
 * changes what the engine is doing, never produces a `Command`, and must never be
 * written into `snapshot` (see the module comment in `state/store.ts`).
 *
 * That is why this type lives here rather than in `@camelia/core`: the engine has no
 * concept of a "mode", and giving it one would create a second source of truth for
 * "what is the user looking at".
 * @module
 */

/** The workbench modes. Adding one means adding a registry entry and an i18n pair. */
export type AppModeId = 'chat' | 'plan' | 'math';

export const APP_MODE_IDS: readonly AppModeId[] = ['chat', 'plan', 'math'];

/** Default mode for a fresh profile — the existing conversation path. */
export const DEFAULT_MODE: AppModeId = 'chat';

export function isAppModeId(value: unknown): value is AppModeId {
  return typeof value === 'string' && (APP_MODE_IDS as readonly string[]).includes(value);
}

/**
 * One entry in the mode registry.
 *
 * `available` is deliberately separate from `enabled`: a mode can be *renderable but not
 * yet useful* (e.g. math before `math.*` commands exist). The tab stays visible so the
 * information architecture is discoverable, while `available: false` makes the workspace
 * show its honest empty state instead of pretending a solver is wired up.
 */
export interface ModeDefinition {
  id: AppModeId;
  /** i18n key for the tab label. */
  labelKey: string;
  /** i18n key for the one-line description shown in the workspace header. */
  descriptionKey: string;
  /** Icon name from `primitives.PATHS`. */
  icon: string;
  /** False when the mode's backend surface does not exist yet in this build. */
  available: boolean;
  /** i18n key explaining what is missing; shown when `available` is false. */
  unavailableReasonKey?: string;
}
