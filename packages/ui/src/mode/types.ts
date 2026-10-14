/**
 * Mode vocabulary — top-level workbench selector (chrome, not domain state).
 *
 * v2026-10-13: Work | Math | Term (团队模式 MVP stub).
 * Legacy `chat` / `plan` ids normalize to `work`.
 * @module
 */

export type AppModeId = 'work' | 'math' | 'term';

export const APP_MODE_IDS: readonly AppModeId[] = ['work', 'math', 'term'];

export const DEFAULT_MODE: AppModeId = 'work';

/** Map legacy and current ids onto the three-mode surface. */
export function normalizeModeId(value: unknown): AppModeId {
  if (value === 'math') return 'math';
  if (value === 'term') return 'term';
  if (value === 'work' || value === 'chat' || value === 'plan') return 'work';
  return DEFAULT_MODE;
}

export function isAppModeId(value: unknown): value is AppModeId {
  return typeof value === 'string' && (APP_MODE_IDS as readonly string[]).includes(value);
}

export interface ModeDefinition {
  id: AppModeId;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  available: boolean;
  unavailableReasonKey?: string;
  /** Soft-deprecate in the mode switcher (stage 20 — team lives in Work). */
  deprecated?: boolean;
}
