/**
 * Small presentation primitives shared by every panel.
 *
 * No business logic: icons, chips, meters, progress bars and the three empty-ish states.
 * Anything here that reads engine state is a pure prop consumer.
 * @module
 */

import type { ReactNode } from 'react';

import mascotUrl from '../assets/mascot.png';

import type { GithubAccountPrefs, UserAvatarMode } from '../state/local-prefs.js';

import { TONE_BG, TONE_DOT, TONE_TEXT, type Tone } from '../lib/status.js';

// ---------------------------------------------------------------------------
// brand mark
// ---------------------------------------------------------------------------

/**
 * The product mark.
 *
 * Deliberately a raster asset rather than an inline SVG path like the rest of
 * `PATHS`: the mark is hand-drawn artwork whose identity is its ink texture and its
 * few colour accents, and a path cannot carry either. `PATHS.camellia` is kept for the
 * icon sheet, but nothing user-facing draws it any more — see `TopBar` and
 * `Conversation`.
 *
 * Clipped to a circle at every size so the same call site works for the 16px top-bar
 * slot and the 80px welcome mark. Pass `alt` only where the mark carries meaning on
 * its own; beside the wordmark it is decorative and stays out of the a11y tree.
 */
export function Mascot({
  size = 16,
  className = '',
  alt,
}: {
  size?: number;
  className?: string;
  alt?: string;
}): ReactNode {
  return (
    <img
      src={mascotUrl}
      alt={alt ?? ''}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      width={size}
      height={size}
      className={`shrink-0 select-none rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

// ---------------------------------------------------------------------------
// icons — inline so the bundle stays dependency-free and Tauri-friendly
// ---------------------------------------------------------------------------

/** Inner SVG markup. 16×16 viewBox, drawing kept inside the 14×14 safe area. */
export const PATHS: Record<string, string> = {
  camellia: [0, 72, 144, 216, 288]
    .map(
      (deg) =>
        `<path fill="currentColor" stroke="none" d="M8 2.6c1.4 0 2.4 1.1 2.4 2.4 0 1.5-1.1 2.8-2.4 2.8S5.6 6.5 5.6 5C5.6 3.7 6.6 2.6 8 2.6z" transform="rotate(${deg} 8 8)"/>`,
    )
    .join('') + '<circle fill="currentColor" stroke="none" cx="8" cy="8" r="1.1"/>',
  play: '<path d="M5.2 3.2v9.6l7-4.8-7-4.8z"/>',
  pause: '<path d="M5.2 3.2v9.6M10.8 3.2v9.6"/>',
  stop: '<rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2"/>',
  check: '<path d="M3.2 8.4 6.3 11.4 12.8 4.4"/>',
  x: '<path d="M4 4l8 8M12 4 4 12"/>',
  dash: '<path d="M3.5 8h9"/>',
  chevron: '<path d="M6 3.6 10.4 8 6 12.4"/>',
  dot: '<circle cx="8" cy="8" r="1.7"/>',
  copy: '<rect x="6" y="6" width="7" height="7" rx="1.3"/><path d="M10 6V4.2A1.2 1.2 0 0 0 8.8 3H4.2A1.2 1.2 0 0 0 3 4.2v4.6A1.2 1.2 0 0 0 4.2 10H6"/>',
  refresh: '<path d="M12.8 8a4.8 4.8 0 1 1-1.5-3.5M12.8 2.6V5.2H10.2"/>',
  undo: '<path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5M3.2 2.6V5.2H5.8"/>',
  shield: '<path d="M8 2.2 12.4 3.8v3.2c0 2.5-1.8 4.4-4.4 5.1-2.6-.7-4.4-2.6-4.4-5.1V3.8L8 2.2z"/>',
  gauge: '<path d="M2.8 11.2a5.2 5.2 0 0 1 10.4 0"/><path d="M8 11.2 10.5 8"/>',
  branch:
    '<circle cx="4.6" cy="3.8" r="1.35"/><circle cx="4.6" cy="12.2" r="1.35"/><circle cx="11.6" cy="8" r="1.35"/><path d="M4.6 5.2v5.6M6 3.8h3.2a2 2 0 0 1 2 2V6.6M6 12.2h3.2a2 2 0 0 0 2-2V9.4"/>',
  terminal: '<rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.3"/><path d="M5 6.4 7.2 8.4 5 10.4M8.6 10.6h3"/>',
  file: '<path d="M9 2.4H5A1.4 1.4 0 0 0 3.6 3.8v8.4A1.4 1.4 0 0 0 5 13.6h6a1.4 1.4 0 0 0 1.4-1.4V6L9 2.4z"/><path d="M9 2.4V6h3.4"/>',
  search: '<circle cx="7.1" cy="7.1" r="3.5"/><path d="M9.8 9.8 13 13"/>',
  spark: '<path d="M8 2.2 9.4 6.2 13.4 8 9.4 9.8 8 13.8 6.6 9.8 2.6 8l4-1.8L8 2.2z"/>',
  alert: '<path d="M8 2.6 13.4 12.4H2.6L8 2.6z"/><path d="M8 6.6v2.6M8 11.2v.1"/>',
  info: '<circle cx="8" cy="8" r="5.4"/><path d="M8 7.2v3.4M8 5.2v.1"/>',
  clock: '<circle cx="8" cy="8" r="5.4"/><path d="M8 4.6V8l2.2 1.4"/>',
  bot: '<rect x="3.2" y="5.6" width="9.6" height="6.6" rx="1.8"/><path d="M8 5.6V3.2M6.3 8.8v.1M9.7 8.8v.1"/>',
  layers: '<path d="M8 2.4 13.2 5.2 8 8 2.8 5.2 8 2.4zM2.8 8.2 8 11l5.2-2.8M2.8 10.8 8 13.6l5.2-2.8"/>',
  compass: '<circle cx="8" cy="8" r="5.4"/><path d="M10.2 5.8 8.8 9.4 5.2 10.8 6.6 7.2 10.2 5.8z"/>',
  repeat: '<path d="M3.2 6.4A2.8 2.8 0 0 1 6 3.6h5.2M12.8 9.6a2.8 2.8 0 0 1-2.8 2.8H4.6M10.2 1.8l1.8 1.8-1.8 1.8M5.8 10.6 4 12.4l1.8 1.8"/>',
  send: '<path d="M13.2 2.8 7.2 8.8M13.2 2.8l-3.8 10.2-2.3-4.1-4.1-2.3 10.2-3.8z"/>',
  eye: '<path d="M2 8s2.1-3.6 6-3.6S14 8 14 8s-2.1 3.6-6 3.6S2 8 2 8z"/><circle cx="8" cy="8" r="1.6"/>',
  grip:
    '<circle cx="6" cy="4.2" r="0.7" fill="currentColor" stroke="none"/><circle cx="10" cy="4.2" r="0.7" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r="0.7" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="0.7" fill="currentColor" stroke="none"/><circle cx="6" cy="11.8" r="0.7" fill="currentColor" stroke="none"/><circle cx="10" cy="11.8" r="0.7" fill="currentColor" stroke="none"/>',
  expand: '<path d="M3.2 2.6v10.8M6.4 5.4 10.6 8 6.4 10.6"/>',
  collapse: '<path d="M3.2 2.6v10.8M10.6 5.4 6.4 8l4.2 2.6"/>',
  // A real cog, not a sun. This used to be a circle with eight rays — which is also what
  // `theme` draws, so the settings entry and the appearance section were near-twins, and at
  // 16px both read as "brightness". Filled with an even-odd hole: a stroked gear at this size
  // is a smudge, because eight teeth plus a hub do not fit in a 2px line.
  settings:
    '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M12.68 6.11 14.46 6.63 14.46 9.37 12.68 9.89 12.65 9.97 13.54 11.59 11.59 13.54 9.97 12.65 9.89 12.68 9.37 14.46 6.63 14.46 6.11 12.68 6.03 12.65 4.41 13.54 2.46 11.59 3.35 9.97 3.32 9.89 1.54 9.37 1.54 6.63 3.32 6.11 3.35 6.03 2.46 4.41 4.41 2.46 6.03 3.35 6.11 3.32 6.63 1.54 9.37 1.54 9.89 3.32 9.97 3.35 11.59 2.46 13.54 4.41 12.65 6.03ZM8 5.75a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 1 0 0 -4.5z"/>',
  theme:
    '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4 11.5 4.5M4.5 11.5 3.4 12.6"/>',
  minimize: '<path d="M3.4 11.6h9.2"/>',
  maximize: '<rect x="3.4" y="3.4" width="9.2" height="9.2" rx="1"/>',
  restore: '<path d="M6 4.2h6.4V10.6M4.2 6H10v6.4"/>',
  pin: '<path d="M6.2 2.2h3.6v3.4l1.4 1.6H4.8l1.4-1.6V2.2z"/><path d="M8 7.2v6.2"/>',
  star: '<path d="M8 2.2 9.6 6.1 13.6 6.5 10.6 9.2 11.5 13.4 8 11.2 4.5 13.4 5.4 9.2 2.4 6.5 6.4 6.1 8 2.2z"/>',
  trash: '<path d="M3.2 4.4h9.6"/><path d="M6.2 4.4V3h3.6v1.4"/><path d="M4.4 4.4l.6 8.4h6l.6-8.4"/>',
  user: '<circle cx="8" cy="5.6" r="2.4"/><path d="M3.2 13.2c0-2.4 2.1-4.2 4.8-4.2s4.8 1.8 4.8 4.2"/>',
  // Math-modeling mode: the summation glyph reads as "model / solve" without needing
  // a bespoke illustration, and stays legible at 12–14px.
  sigma:
    '<path d="M11.6 3.2H4.6l3.6 4.8-3.6 4.8h7"/>',
  // Flow / pipeline (math stages, plan lifecycle).
  flow: '<rect x="2.4" y="2.6" width="4.2" height="3.4" rx="1"/><rect x="9.4" y="10" width="4.2" height="3.4" rx="1"/><path d="M4.5 6v3.6a1.8 1.8 0 0 0 1.8 1.8h3.1"/>',
  // Ruler / acceptance — used by the math stage chips.
  ruler: '<rect x="2.4" y="5.6" width="11.2" height="4.8" rx="1"/><path d="M5.4 5.6v2M8 5.6v2.8M10.6 5.6v2"/>',
  // Send, in the shape every chat app has settled on. Distinct from `send` (a paper
  // plane) because the composer's circular button needs a glyph that reads as "up" at
  // 15px inside a filled disc, and a paper plane does not.
  arrowUp: '<path d="M8 13V3.4M3.9 7.5 8 3.4l4.1 4.1"/>',
  // Chat / sessions. The left icon rail needs a glyph for "the conversation list" that is
  // not `layers` (provider stack) or `terminal` (event trail) — both already spoken for.
  chat: '<path d="M13.4 4.2v5.2a1.4 1.4 0 0 1-1.4 1.4H7.4l-2.8 2.4v-2.4H4a1.4 1.4 0 0 1-1.4-1.4V4.2A1.4 1.4 0 0 1 4 2.8h8a1.4 1.4 0 0 1 1.4 1.4z"/>',
  // Right drawer. A window with a vertical split, the right pane marked — the same
  // glyph chat apps use for "open the side panel", drawn at the same 16px stroke as the rest.
  panelRight: '<rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.4"/><path d="M9.4 2.8v10.4"/>',
  panelLeft: '<rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.4"/><path d="M6.6 2.8v10.4"/>',
  plus: '<path d="M8 3.6v8.8M3.6 8h8.8"/>',
  // VS Code's extensions mark: four tiles. The activity bar uses it for the plugin sidebar.
  extensions:
    '<rect x="2.2" y="2.2" width="4.6" height="4.6" rx="0.8"/><rect x="9.2" y="2.2" width="4.6" height="4.6" rx="0.8"/><rect x="2.2" y="9.2" width="4.6" height="4.6" rx="0.8"/><rect x="9.2" y="9.2" width="4.6" height="4.6" rx="0.8"/>',
  // Folder, for the workspace path in the status bar. Drawn as an outline folder with a
  // tab, so it does not read as a generic square at 11px.
  folder:
    '<path d="M2.4 12.2V4.4A1.2 1.2 0 0 1 3.6 3.2h2.5l1.3 1.6h5A1.2 1.2 0 0 1 13.6 6v6.2a1.2 1.2 0 0 1-1.2 1.2H3.6a1.2 1.2 0 0 1-1.2-1.2z"/>',
  filter: '<path d="M2.6 3.2h10.8L9.2 8.2v4.2l-2.4-1.2V8.2L2.6 3.2z"/>',
};

export const ICON_NAMES = Object.keys(PATHS);

export function Icon({
  name,
  size = 15,
  className = '',
  filled = false,
  strokeWidth = 2,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
  filled?: boolean;
  strokeWidth?: number;
}): ReactNode {
  const path = PATHS[name] ?? PATHS.dot;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: path ?? '' }}
    />
  );
}

// ---------------------------------------------------------------------------
// chips, dots, meters
// ---------------------------------------------------------------------------

export function Chip({
  tone = 'muted',
  children,
  className = '',
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}): ReactNode {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-medium leading-4 ${TONE_BG[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }): ReactNode {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
      {pulse ? <span className={`camelia-pulse absolute inset-0 rounded-full ${TONE_DOT[tone]}`} /> : null}
    </span>
  );
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: Tone }): ReactNode {
  const width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
      <div className={`h-full rounded-full transition-[width] duration-500 ${TONE_DOT[tone]}`} style={{ width }} />
    </div>
  );
}

export function SectionHeader({
  icon,
  title,
  right,
  id,
}: {
  icon?: string;
  title: string;
  right?: ReactNode;
  id?: string;
}): ReactNode {
  return (
    <div id={id} className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">
        {icon ? <Icon name={icon} size={13} /> : null}
        {title}
      </div>
      {right}
    </div>
  );
}

export function KeyHint({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="rounded border border-line bg-hover px-1.5 py-[1px] font-mono text-[10px] text-ink-2">
      {children}
    </kbd>
  );
}

export function Card({
  children,
  className = '',
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: Tone;
}): ReactNode {
  const border = tone ? TONE_TEXT[tone] : '';
  return (
    <div className={`rounded-lg border border-line bg-elevated/70 ${border} ${className}`}>{children}</div>
  );
}


// ---------------------------------------------------------------------------
// chat avatars (WeChat-style circles)
// ---------------------------------------------------------------------------

export function Avatar({
  kind,
  size = 32,
  className = '',
  title,
  src,
}: {
  kind: 'user' | 'agent';
  size?: number;
  className?: string;
  title?: string;
  /**
   * Image to draw instead of the letter disc. The user side passes
   * `userAvatarSrc(...)` so the "no avatar set" case is decided once, in one place,
   * rather than re-derived at every call site.
   */
  src?: string;
}): ReactNode {
  if (src) {
    return (
      <span
        data-avatar={kind}
        title={title}
        className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`}
        style={{ width: size, height: size }}
        aria-hidden={title ? undefined : true}
      >
        <img src={src} alt="" draggable={false} className="h-full w-full select-none object-cover" />
      </span>
    );
  }
  const text = kind === 'user' ? '你' : '花';
  const tone = kind === 'user' ? 'wf-avatar-user' : 'wf-avatar-agent';
  const fontSize = Math.max(11, Math.round(size * 0.42));
  return (
    <span
      data-avatar={kind}
      title={title}
      className={`inline-grid shrink-0 place-items-center rounded-full font-medium ${tone} ${className}`}
      style={{ width: size, height: size, fontSize }}
      aria-hidden={title ? undefined : true}
    >
      {text}
    </span>
  );
}

/**
 * Resolve the user's avatar image.
 *
 * GitHub profile wins when signed in (user bubbles use the GitHub avatar).
 * Otherwise `mascot` → product mark, `letter` → undefined (letter disc).
 */
export function userAvatarSrc(
  mode: UserAvatarMode,
  github?: GithubAccountPrefs | null,
): string | undefined {
  if (github?.avatarUrl) return github.avatarUrl;
  return mode === 'letter' ? undefined : mascotUrl;
}

// ---------------------------------------------------------------------------
// the three states every panel must have
// ---------------------------------------------------------------------------

export function EmptyState({
  icon = 'spark',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-14 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-elevated text-ink-3">
        <Icon name={icon} size={20} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {hint ? <p className="mx-auto max-w-sm text-xs leading-5 text-ink-3">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Connecting to the engine' }: { label?: string }): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-14">
      <div className="relative h-1 w-40 overflow-hidden rounded-full bg-hover">
        <span className="camelia-sweep absolute inset-0 block" />
      </div>
      <p className="text-xs text-ink-3">{label}</p>
    </div>
  );
}

export function ErrorState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }): ReactNode {
  return (
    <div className="m-4 flex flex-col gap-3 rounded-lg border border-bad/30 bg-bad/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-bad">
        <Icon name="alert" size={15} />
        {title}
      </div>
      {detail ? <p className="font-mono text-xs leading-5 text-ink-2">{detail}</p> : null}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }): ReactNode {
  return (
    <div className="space-y-2 p-3" aria-hidden="true">
      {Array.from({ length: rows }, (_v, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-hover" />
          <div className="h-2.5 flex-1 rounded bg-hover" style={{ maxWidth: `${88 - i * 11}%` }} />
        </div>
      ))}
    </div>
  );
}