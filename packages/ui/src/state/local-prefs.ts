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

import type { ChatPolicy } from '@camelia/core';

import { applyThemeTokens, clearThemeTokens, type ThemeApplyResult } from '../theme/apply-theme.js';
import { applyPreset, type ThemeId } from '../theme/presets.js';
import { DEFAULT_MODE, normalizeModeId, type AppModeId } from '../mode/types.js';

export const LOCAL_PREFS_KEY = 'camelia.localPrefs';

/**
 * Bump when a one-shot layout migration must run for existing installs.
 *
 * v5 — `planApproval` defaulted to `always` before this version; a stored `always` from
 *      an older install is a leftover default, not a choice, and is re-read as unset.
 * v6 — the right data rail is gone (its panels moved into the header + a main-area deck).
 *      Stored `rightWidth` / `rightCollapsed` are dropped, not migrated.
 * v7 — `chatPolicy` added.
 * v8 — Work|Math modes; right rail prefs restored (F3); preferredMode chat/plan → work.
 * v9 — githubAccount (public profile; token in separate localStorage key).
 */
export const LOCAL_PREFS_VERSION = 9;

export const RAIL_LEFT_DEFAULT = 260;
export const RAIL_COLLAPSED = 48;
/**
 * Width of the permanent left nav that sits outside the session column.
 *
 * Wide enough for an icon and a short label (聊天记录 / 插件 / 设置). The session
 * column still closes to 0 — this nav is what reopens it — so the old 48px icon
 * strip is not a second collapsed column.
 */
export const RAIL_ICON_WIDTH = 148;
export const RAIL_LEFT_MIN = 200;
export const RAIL_LEFT_MAX = 420;
export const RAIL_RIGHT_DEFAULT = 320;
export const RAIL_RIGHT_MIN = 240;
export const RAIL_RIGHT_MAX = 480;

export type TopBarMode = 'auto' | 'pinned' | 'hidden';
export type MotionPref = 'system' | 'reduce';
export type LanguagePref = 'en' | 'zh';
export type EffortPref = 'max' | 'high' | 'low';

/**
 * Which mark the user's own messages and the rail's profile row carry.
 *
 * `mascot` is the default: a fresh install signs the user's messages with the product
 * mark rather than a placeholder glyph. `letter` keeps the original 「你」 disc for
 * anyone who finds a photographic mark beside their own words odd.
 */
export type UserAvatarMode = 'mascot' | 'letter';

/** Public GitHub profile for the account mark and user message avatars. */
export interface GithubAccountPrefs {
  login: string;
  name: string;
  avatarUrl: string;
}

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface LocalPrefs {
  /** Schema version. Bumped when a stored value stops meaning what it used to. */
  version: number;
  leftWidth: number;
  leftCollapsed: boolean;
  rightWidth: number;
  rightCollapsed: boolean;
  themeId: ThemeId;
  language: LanguagePref;
  topBar: TopBarMode;
  motion: MotionPref;
  /** Passed through `--font-mono`. Empty keeps the stylesheet stack. */
  fontMono: string;
  /**
   * Whether a plan is shown for approval before the run proceeds.
   *
   * Defaults to `auto` on the desktop. The gate is a *review* affordance, not a security
   * boundary — risky tool calls have their own approval and keep asking. Blocking every
   * conversation on a plan the user rarely edits is friction with no safety payoff, and
   * it was the single most common complaint about the shell.
   *
   * This is a window-local default; the durable value lives in `~/.camelia/config.json`
   * and outranks it (`App` reconciles the two at boot). Headless `camelia` keeps `always`
   * — nobody is watching a CLI to click approve.
   */
  planApproval: 'always' | 'auto';
  /**
   * Mode a new window opens in. Window chrome, not domain state — the engine has no
   * notion of a mode. See `mode/types.ts`.
   */
  preferredMode: AppModeId;
  /** WeChat-style message avatars. Default on; the toggle lives in Settings → 外观. */
  showAvatars: boolean;
  /**
   * The mark on the user's own messages. The engine has no accounts, so this is chrome
   * — it never reaches `snapshot`. See `UserAvatarMode`.
   */
  userAvatar: UserAvatarMode;
  /** When set, user bubbles / rail prefer avatarUrl over userAvatar. */
  githubAccount: GithubAccountPrefs | null;
  /**
   * Name shown in the rail's bottom profile row. Empty means "use the built-in label"
   * (`UserAvatarMode`'s sibling decision: nothing to configure, nothing invented).
   */
  displayName: string;
  /**
   * The tool permission posture for chat turns (对话 mode), sent verbatim with every
   * `chat_message`. The default is deliberately the most restrictive posture — broader
   * access is an explicit user decision, made once, next to the thing it changes.
   */
  chatPolicy: ChatPolicy;
  /** Work-mode generation effort (composer chips). */
  effort: EffortPref;
  window?: WindowGeometry;
}

export const DEFAULT_LOCAL_PREFS: LocalPrefs = {
  version: LOCAL_PREFS_VERSION,
  leftWidth: RAIL_LEFT_DEFAULT,
  leftCollapsed: false,
  rightWidth: RAIL_RIGHT_DEFAULT,
  rightCollapsed: true,
  themeId: 'light',
  language: 'zh',
  topBar: 'pinned',
  motion: 'system',
  fontMono: '',
  planApproval: 'auto',
  preferredMode: DEFAULT_MODE,
  showAvatars: true,
  userAvatar: 'mascot',
  githubAccount: null,
  displayName: '',
  chatPolicy: 'readonly-sandbox',
  effort: 'high',
};

const THEME_IDS: readonly ThemeId[] = ['warm-dark', 'cool-dark', 'light', 'high-contrast'];
const LANGS: readonly LanguagePref[] = ['en', 'zh'];
const TOP_BAR_MODES: readonly TopBarMode[] = ['auto', 'pinned', 'hidden'];
const MOTION_PREFS: readonly MotionPref[] = ['system', 'reduce'];
const USER_AVATAR_MODES: readonly UserAvatarMode[] = ['mascot', 'letter'];
const CHAT_POLICIES: readonly ChatPolicy[] = ['readonly-sandbox', 'ask', 'full'];
const EFFORTS: readonly EffortPref[] = ['max', 'high', 'low'];

/**
 * Clamp a session-column width to the resizable range.
 *
 * No `side` argument any more: the right rail was removed, so the only thing that can be
 * clamped is the session column. A one-valued discriminator would be a knob that cannot
 * turn.
 */
export function clampRail(width: number, side: 'left' | 'right' = 'left'): number {
  if (!Number.isFinite(width)) return side === 'right' ? RAIL_RIGHT_DEFAULT : RAIL_LEFT_DEFAULT;
  if (side === 'right') return Math.round(Math.min(RAIL_RIGHT_MAX, Math.max(RAIL_RIGHT_MIN, width)));
  return Math.round(Math.min(RAIL_LEFT_MAX, Math.max(RAIL_LEFT_MIN, width)));
}

/**
 * Width of the session column, in px. Collapsed reads as 0 rather than as a strip.
 *
 * The permanent icon rail already occupies that position and carries the re-open control,
 * so keeping a 48px session strip as well would draw two expand buttons for one panel,
 * side by side.
 */
export function railWidth(prefs: LocalPrefs): number {
  return prefs.leftCollapsed ? 0 : prefs.leftWidth;
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
  const window = sanitizeWindow(raw?.window);
  const rawVersion = prefsVersionOf(raw);
  // Only `always` is treated as an opt-in; anything missing or unrecognised takes the
  // default. Reading it the other way round would turn a corrupt value into a nag.
  //
  // The version guard matters: before v5 this key defaulted to `always`, so every install
  // has it stored whether or not the user ever opened the control. A pre-v5 `always` is
  // therefore not evidence of intent, and is dropped exactly once.
  const planApproval =
    rawVersion >= 5 && raw?.planApproval === 'always' ? 'always' : DEFAULT_LOCAL_PREFS.planApproval;
  return {
    version: LOCAL_PREFS_VERSION,
    leftWidth: clampRail(raw?.leftWidth ?? RAIL_LEFT_DEFAULT),
    leftCollapsed: raw?.leftCollapsed === true,
    rightWidth: clampRail(raw?.rightWidth ?? RAIL_RIGHT_DEFAULT, 'right'),
    rightCollapsed: true,
    themeId,
    language,
    topBar,
    motion,
    fontMono,
    planApproval,
    // Unknown / legacy values fall back to the default rather than reaching the UI.
    preferredMode: normalizeModeId(raw?.preferredMode),
    // Only an explicit `false` disables avatars; absent (older install) means on.
    showAvatars: raw?.showAvatars !== false,
    // Same permissive rule: an older install has no opinion, so it gets the mascot.
    userAvatar: USER_AVATAR_MODES.includes(raw?.userAvatar as UserAvatarMode)
      ? (raw?.userAvatar as UserAvatarMode)
      : DEFAULT_LOCAL_PREFS.userAvatar,
    githubAccount: sanitizeGithubAccount(raw?.githubAccount),
    displayName: typeof raw?.displayName === 'string' ? raw.displayName.slice(0, 48) : '',
    chatPolicy: CHAT_POLICIES.includes(raw?.chatPolicy as ChatPolicy)
      ? (raw?.chatPolicy as ChatPolicy)
      : DEFAULT_LOCAL_PREFS.chatPolicy,
    effort: EFFORTS.includes(raw?.effort as EffortPref)
      ? (raw?.effort as EffortPref)
      : DEFAULT_LOCAL_PREFS.effort,
    ...(window ? { window } : {}),
  };
}

function sanitizeGithubAccount(value: GithubAccountPrefs | null | undefined): GithubAccountPrefs | null {
  if (!value || typeof value !== 'object') return null;
  const login = typeof value.login === 'string' ? value.login.trim().slice(0, 64) : '';
  const avatarUrl = typeof value.avatarUrl === 'string' ? value.avatarUrl.trim().slice(0, 512) : '';
  if (!login || !avatarUrl) return null;
  const name =
    typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 80) : login;
  return { login, name, avatarUrl };
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
    // A stored blob is rewritten whenever it does not already equal the sanitized form.
    // That covers schema bumps (v6 dropped the right-rail knobs) and silently repairs a
    // corrupt key, so the next boot never has to reason about what used to be there.
    const boot = sanitizeLocalPrefs(parsedRaw);
    if (prefsVersionOf(parsedRaw) < LOCAL_PREFS_VERSION || JSON.stringify(parsedRaw) !== JSON.stringify(boot)) {
      bin.setItem(LOCAL_PREFS_KEY, JSON.stringify(boot));
    }
    return boot;
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
