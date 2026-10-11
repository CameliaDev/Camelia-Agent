/**
 * Window-local preferences.
 *
 * This is the second deliberate exception to "the store never invents business
 * state" (see the module comment in `store.ts`, and the memory panel's query
 * surface before it). Collapse, rail width, theme, motion and window geometry
 * are chrome for *this window*. They are not a fold of the domain event stream,
 * they are not commands, and they must never be written into `snapshot`.
 *
 * Persistence is `localStorage` on purpose: these values do not belong in
 * `~/.camelia` and they do not justify a Tauri plugin.
 * @module
 */

import { applyThemeTokens, clearThemeTokens, type ThemeApplyResult } from '../theme/apply-theme.js';
import { applyPreset, type ThemeId } from '../theme/presets.js';

export const LOCAL_PREFS_KEY = 'camelia.localPrefs';

/** Bump when a one-shot layout migration must run for existing installs. */
export const LOCAL_PREFS_VERSION = 3;

export const RAIL_LEFT_DEFAULT = 260;
export const RAIL_RIGHT_DEFAULT = 360;
export const RAIL_COLLAPSED = 48;
export const RAIL_LEFT_MIN = 200;
export const RAIL_LEFT_MAX = 420;
export const RAIL_RIGHT_MIN = 280;
export const RAIL_RIGHT_MAX = 560;

export type TopBarMode = 'auto' | 'pinned' | 'hidden';
export type MotionPref = 'system' | 'reduce';
export type LanguagePref = 'en' | 'zh';

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface LocalPrefs {
  /** Schema version. < 3 means a forced right-rail collapse migration is due. */
  version: number;
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /**
   * True only after the user explicitly toggles the right rail (ActivityBar /
   * rail chrome / Settings). Without this flag, expanded state from older
   * installs is ignored — v2 already stamped version:2 while keeping the old
   * expanded default, so version alone is not enough.
   */
  userSetRightRail: boolean;
  themeId: ThemeId;
  language: LanguagePref;
  topBar: TopBarMode;
  motion: MotionPref;
  /** Passed through `--font-mono`. Empty keeps the stylesheet stack. */
  fontMono: string;
  planApproval: 'always' | 'auto';
  window?: WindowGeometry;
}

export const DEFAULT_LOCAL_PREFS: LocalPrefs = {
  version: LOCAL_PREFS_VERSION,
  leftWidth: RAIL_LEFT_DEFAULT,
  rightWidth: RAIL_RIGHT_DEFAULT,
  leftCollapsed: false,
  rightCollapsed: true,
  userSetRightRail: false,
  themeId: 'light',
  language: 'zh',
  topBar: 'pinned',
  motion: 'system',
  fontMono: '',
  planApproval: 'always',
};

const THEME_IDS: readonly ThemeId[] = ['warm-dark', 'cool-dark', 'light', 'high-contrast'];
const LANGS: readonly LanguagePref[] = ['en', 'zh'];
const TOP_BAR_MODES: readonly TopBarMode[] = ['auto', 'pinned', 'hidden'];
const MOTION_PREFS: readonly MotionPref[] = ['system', 'reduce'];

export function clampRail(side: 'left' | 'right', width: number): number {
  const min = side === 'left' ? RAIL_LEFT_MIN : RAIL_RIGHT_MIN;
  const max = side === 'left' ? RAIL_LEFT_MAX : RAIL_RIGHT_MAX;
  if (!Number.isFinite(width)) return side === 'left' ? RAIL_LEFT_DEFAULT : RAIL_RIGHT_DEFAULT;
  return Math.round(Math.min(max, Math.max(min, width)));
}

export function railWidth(prefs: LocalPrefs, side: 'left' | 'right'): number {
  if (side === 'left') return prefs.leftCollapsed ? RAIL_COLLAPSED : prefs.leftWidth;
  return prefs.rightCollapsed ? RAIL_COLLAPSED : prefs.rightWidth;
}

/** Patch used by chrome toggles so expanded state is remembered across boots. */
export function rightRailUserPatch(collapsed: boolean): Pick<LocalPrefs, 'rightCollapsed' | 'userSetRightRail'> {
  return { rightCollapsed: collapsed, userSetRightRail: true };
}

function storageOf(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage;
}

function prefsVersionOf(raw: Partial<LocalPrefs> | null | undefined): number {
  const v = raw?.version;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  return 0;
}

export function sanitizeLocalPrefs(raw: Partial<LocalPrefs> | null | undefined): LocalPrefs {
  const themeId = THEME_IDS.includes(raw?.themeId as ThemeId) ? (raw?.themeId as ThemeId) : DEFAULT_LOCAL_PREFS.themeId;
  const language = LANGS.includes(raw?.language as LanguagePref) ? (raw?.language as LanguagePref) : DEFAULT_LOCAL_PREFS.language;
  const topBar = TOP_BAR_MODES.includes(raw?.topBar as TopBarMode) ? (raw?.topBar as TopBarMode) : DEFAULT_LOCAL_PREFS.topBar;
  const motion = MOTION_PREFS.includes(raw?.motion as MotionPref) ? (raw?.motion as MotionPref) : DEFAULT_LOCAL_PREFS.motion;
  const fontMono = typeof raw?.fontMono === 'string' ? raw.fontMono.slice(0, 200) : '';
  const planApproval = raw?.planApproval === 'auto' ? 'auto' : 'always';
  const window = sanitizeWindow(raw?.window);
  const rawVersion = prefsVersionOf(raw);
  // v3: force collapse for anyone who has not explicitly toggled the rail.
  // Covers (a) pre-v2 expanded defaults, (b) v2 installs that stamped
  // version:2 while keeping rightCollapsed:false from old storage.
  const migratingToV3 = rawVersion < 3;
  const userSetRightRail = !migratingToV3 && raw?.userSetRightRail === true;
  const rightCollapsed = userSetRightRail ? raw?.rightCollapsed === true : true;
  return {
    version: LOCAL_PREFS_VERSION,
    leftWidth: clampRail('left', raw?.leftWidth ?? RAIL_LEFT_DEFAULT),
    rightWidth: clampRail('right', raw?.rightWidth ?? RAIL_RIGHT_DEFAULT),
    leftCollapsed: raw?.leftCollapsed === true,
    rightCollapsed,
    userSetRightRail,
    themeId,
    language,
    topBar,
    motion,
    fontMono,
    planApproval,
    ...(window ? { window } : {}),
  };
}

function sanitizeWindow(value: WindowGeometry | undefined): WindowGeometry | undefined {
  if (!value) return undefined;
  const width = Number(value.width);
  const height = Number(value.height);
  const x = Number(value.x);
  const y = Number(value.y);
  if (![width, height, x, y].every(Number.isFinite)) return undefined;
  if (width < 1024 || height < 680 || width > 8000 || height > 8000) return undefined;
  return { x, y, width, height, maximized: value.maximized === true };
}

export function loadLocalPrefs(storage?: Storage): LocalPrefs {
  const bin = storageOf(storage);
  if (!bin) return { ...DEFAULT_LOCAL_PREFS };
  try {
    const raw = bin.getItem(LOCAL_PREFS_KEY);
    if (!raw) return { ...DEFAULT_LOCAL_PREFS };
    const parsedRaw = JSON.parse(raw) as Partial<LocalPrefs>;
    const parsed = sanitizeLocalPrefs(parsedRaw);
    // Persist the migration immediately so a later expand/collapse is not
    // re-forced on the next boot.
    if (
      prefsVersionOf(parsedRaw) < LOCAL_PREFS_VERSION ||
      parsedRaw.userSetRightRail !== parsed.userSetRightRail ||
      parsedRaw.rightCollapsed !== parsed.rightCollapsed
    ) {
      bin.setItem(LOCAL_PREFS_KEY, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return { ...DEFAULT_LOCAL_PREFS };
  }
}

export function saveLocalPrefs(prefs: LocalPrefs, storage?: Storage): void {
  const bin = storageOf(storage);
  if (!bin) return;
  bin.setItem(LOCAL_PREFS_KEY, JSON.stringify(sanitizeLocalPrefs(prefs)));
}

/** Apply a saved theme through the whitelist. Warm Dark clears inline overrides. */
export function applySavedTheme(prefs: LocalPrefs): ThemeApplyResult {
  const tokens = { ...applyPreset(prefs.themeId) };
  if (prefs.fontMono) tokens['--font-mono'] = prefs.fontMono;
  if (prefs.themeId === 'warm-dark') clearThemeTokens();
  const result = applyThemeTokens(tokens);
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = prefs.themeId;
  syncMotion(prefs);
  return result;
}

export function syncMotion(prefs: LocalPrefs): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = prefs.motion;
}

export function syncLang(prefs: LocalPrefs): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = prefs.language === 'zh' ? 'zh-CN' : 'en';
}
