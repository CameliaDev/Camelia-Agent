/**
 * Terminal theme — the camellia palette, in 24-bit ANSI.
 *
 * The CLI is the first surface a user sees, so it uses the same warm tokens as the
 * UI (whitepaper §6.5): near-black backgrounds never appear (terminals own the
 * background), but the foreground accents are identical — camellia red for
 * emphasis, warm white for text, warm green/red for diff and verdicts.
 *
 * Colour is opt-out, never opt-in: piping to a file or setting `NO_COLOR` yields
 * plain text with no escape codes.
 * @module
 */

const ESC = '\u001b[';

/** 24-bit foreground from a `#rrggbb` literal. */
function fg(hex: string): (text: string) => string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (text) => `${ESC}38;2;${r};${g};${b}m${text}${ESC}39m`;
}

const bold = (text: string): string => `${ESC}1m${text}${ESC}22m`;

const identity = (text: string): string => text;

export interface Theme {
  /** Camellia red — the single accent. */
  accent: (text: string) => string;
  accentBold: (text: string) => string;
  text: (text: string) => string;
  dim: (text: string) => string;
  bold: (text: string) => string;
  /** Warm green — additions, success, verified. */
  green: (text: string) => string;
  /** Warm red — deletions, failure, blocked. */
  red: (text: string) => string;
  /** Warm amber — warnings, unverified, in-flight. */
  amber: (text: string) => string;
  /** Neutral grey — secondary metadata. */
  grey: (text: string) => string;
}

const COLOUR_THEME: Theme = {
  accent: fg('#D96C5F'),
  accentBold: (text) => bold(fg('#D96C5F')(text)),
  text: fg('#F7EFE9'),
  dim: fg('#8A7D78'),
  bold,
  green: fg('#9DBF7A'),
  red: fg('#D96C5F'),
  amber: fg('#E0A458'),
  grey: fg('#A7968F'),
};

const PLAIN_THEME: Theme = {
  accent: identity,
  accentBold: identity,
  text: identity,
  dim: identity,
  bold: identity,
  green: identity,
  red: identity,
  amber: identity,
  grey: identity,
};

/**
 * Decide whether colour is appropriate.
 *
 * `--color` / `--no-color` win outright; otherwise colour is enabled only when
 * stdout is a TTY and the environment has not asked for plain output.
 */
export function resolveColour(override: 'auto' | 'always' | 'never'): boolean {
  if (override === 'always') return true;
  if (override === 'never') return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

export function createTheme(colour: boolean): Theme {
  return colour ? COLOUR_THEME : PLAIN_THEME;
}