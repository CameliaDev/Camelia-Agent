/**
 * Mode vocabulary — top-level workbench selector (chrome, not domain state).
 *
 * v2026-10-13: converged to Work | Math (F6). Legacy `chat` / `plan` ids normalize to `work`.
 * @module
 */

export type AppModeId = 'work' | 'math';

export const APP_MODE_IDS: readonly AppModeId[] = ['work', 'math'];

export const DEFAULT_MODE: AppModeId = 'work';

/** Map legacy and current ids onto the two-mode surface. */
export function normalizeModeId(value: unknown): AppModeId {
  if (value === 'math') return 'math';
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
}
