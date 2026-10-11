/**
 * Theme runtime — applies a validated theme's tokens as CSS custom properties.
 *
 * Whitepaper §8.4: a theme is a set of tokens, and the loader has already run
 * them through {@link THEME_TOKEN_WHITELIST}. This module's job is the last
 * mile, and it exists as a separate, tested unit because "the plugin loaded"
 * and "the screen changed colour" are different claims.
 *
 * Two rules:
 *
 * 1. **Only whitelisted tokens are applied.** The loader validates, but this
 *    function is the one that actually writes to the DOM, so it re-checks. A
 *    theme is data from a file that appeared after install; defence at the point
 *    of use costs one `includes`.
 * 2. **Values are validated, not escaped.** A CSS value can break out of a
 *    declaration and inject arbitrary rules, so anything containing a `;`, `{`,
 *    `}`, `<` or a newline is rejected outright rather than escaped — an escaped
 *    value that still renders is harder to reason about than a rejected one.
 *
 * @module
 */

/**
 * The tokens a theme may set.
 *
 * Deliberately duplicated from `core`'s `THEME_TOKEN_WHITELIST` rather than
 * imported: `core`'s entry pulls in `node:crypto`, which is not browser-safe, so
 * a value import from it breaks the webview build. The list is data, and the
 * test below asserts the two stay in step — a duplicated constant with a
 * conformance test beats a build-time bundler workaround.
 */
export const THEME_TOKEN_WHITELIST = [
  '--color-base',
  '--color-elevated',
  '--color-panel',
  '--color-hover',
  '--color-line',
  '--color-ink',
  '--color-ink-2',
  '--color-ink-3',
  '--color-accent',
  '--color-accent-2',
  '--color-accent-dim',
  '--color-ok',
  '--color-bad',
  '--color-warn',
  '--color-info',
  '--color-add',
  '--color-del',
  '--radius-md',
  '--radius-lg',
  '--font-mono',
] as const;

export interface ThemeRuntimeOptions {
  /** Where to write the tokens. Defaults to `document.documentElement`. */
  target?: HTMLElement;
  /** Reported when a token is refused, for diagnostics and tests. */
  onReject?: (token: string, reason: string) => void;
}

/** Characters that let a value escape its declaration or open a new rule. */
const FORBIDDEN = /[;{}<>\n\r]/;

export interface ThemeApplyResult {
  /** Tokens actually written. */
  applied: string[];
  /** Tokens refused, with the reason. */
  rejected: Array<{ token: string; reason: string }>;
}

/**
 * Apply theme tokens to an element as CSS custom properties.
 *
 * Returns what was applied and what was refused rather than throwing: a partly
 * applied theme is a reasonable outcome for a cosmetic plugin, and refusing to
 * render at all because one colour is malformed would be a worse failure.
 */
export function applyThemeTokens(
  tokens: Record<string, string> | undefined | null,
  options: ThemeRuntimeOptions = {},
): ThemeApplyResult {
  const target = options.target ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  const applied: string[] = [];
  const rejected: Array<{ token: string; reason: string }> = [];

  if (!tokens || !target) {
    return { applied, rejected };
  }

  for (const [token, rawValue] of Object.entries(tokens)) {
    if (!(THEME_TOKEN_WHITELIST as readonly string[]).includes(token)) {
      const reason = 'token is not on the whitelist';
      rejected.push({ token, reason });
      options.onReject?.(token, reason);
      continue;
    }
    const value = String(rawValue ?? '').trim();
    if (value.length === 0) {
      const reason = 'value is empty';
      rejected.push({ token, reason });
      options.onReject?.(token, reason);
      continue;
    }
    if (FORBIDDEN.test(value)) {
      // A `;` or `}` here would end the declaration and let the rest of the value
      // become new CSS. Refuse instead of escaping.
      const reason = 'value contains characters that could break out of the declaration';
      rejected.push({ token, reason });
      options.onReject?.(token, reason);
      continue;
    }
    target.style.setProperty(token, value);
    applied.push(token);
  }

  return { applied, rejected };
}

/**
 * Remove every themeable token from an element.
 *
 * Restoring the built-in palette is not the same as removing properties: the
 * stylesheet's own `:root` values only take effect once the inline override is
 * gone.
 */
export function clearThemeTokens(target?: HTMLElement): string[] {
  const element = target ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (!element) return [];
  const cleared: string[] = [];
  for (const token of THEME_TOKEN_WHITELIST) {
    if (element.style.getPropertyValue(token)) {
      element.style.removeProperty(token);
      cleared.push(token);
    }
  }
  return cleared;
}