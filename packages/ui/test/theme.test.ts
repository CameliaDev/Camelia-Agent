/**
 * Theme runtime — token application and refusal.
 *
 * The theme extension point (whitepaper §8.4) lets a data file change the
 * palette. That makes it a styling input from outside the codebase, so the tests
 * weight refusals at least as heavily as applications: a token that escapes its
 * declaration could restyle the app or, worse, execute.
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest';

import { THEME_TOKEN_WHITELIST as CORE_WHITELIST } from '@camelia/core';

import { applyThemeTokens, clearThemeTokens, THEME_TOKEN_WHITELIST } from '../src/theme/apply-theme.js';

const root = (): HTMLElement => document.documentElement;

afterEach(() => {
  clearThemeTokens(root());
});

describe('theme whitelist', () => {
  it('matches the core whitelist exactly', () => {
    // The UI copy exists only because importing the core *value* pulls in
    // `node:crypto`, which breaks the webview build. A duplicated constant is
    // only safe while this test holds — if the lists drift, a theme the loader
    // accepts would be rejected here, or worse, vice versa.
    expect([...THEME_TOKEN_WHITELIST].sort()).toEqual([...CORE_WHITELIST].sort());
  });
});

describe('applyThemeTokens — applies', () => {
  it('writes a whitelisted token as a CSS custom property', () => {
    const result = applyThemeTokens({ '--color-base': '#101010' });
    expect(result.applied).toEqual(['--color-base']);
    expect(root().style.getPropertyValue('--color-base')).toBe('#101010');
  });

  it('applies several tokens at once', () => {
    const result = applyThemeTokens({
      '--color-base': '#101010',
      '--color-accent': '#ff0000',
      '--radius-md': '8px',
    });
    expect(result.applied).toHaveLength(3);
    expect(root().style.getPropertyValue('--color-accent')).toBe('#ff0000');
  });

  it('trims surrounding whitespace', () => {
    applyThemeTokens({ '--color-base': '  #202020  ' });
    expect(root().style.getPropertyValue('--color-base')).toBe('#202020');
  });

  it('accepts an rgb() value', () => {
    applyThemeTokens({ '--color-ink': 'rgb(247, 239, 233)' });
    expect(root().style.getPropertyValue('--color-ink')).toBe('rgb(247, 239, 233)');
  });

  it('applies to a supplied target instead of the document', () => {
    const other = document.createElement('div');
    applyThemeTokens({ '--color-base': '#abcdef' }, { target: other });
    expect(other.style.getPropertyValue('--color-base')).toBe('#abcdef');
  });
});

describe('applyThemeTokens — refuses', () => {
  it('ignores a token that is not on the whitelist', () => {
    // Arbitrary CSS injection is an XSS vector; the whitelist is the boundary.
    const result = applyThemeTokens({ '--evil': 'red', 'position': 'fixed' });
    expect(result.applied).toEqual([]);
    expect(result.rejected.map((r) => r.token).sort()).toEqual(['--evil', 'position']);
  });

  it('refuses a value that could end the declaration and start a new rule', () => {
    // `;` here would close the declaration and let the rest become new CSS.
    const result = applyThemeTokens({ '--color-base': '#fff; position: fixed' });
    expect(result.applied).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/break out/);
    expect(root().style.getPropertyValue('--color-base')).toBe('');
  });

  it('refuses a value containing a brace', () => {
    expect(applyThemeTokens({ '--color-base': '#fff} body{display:none' }).applied).toEqual([]);
  });

  it('refuses a value containing markup', () => {
    expect(applyThemeTokens({ '--color-base': '</style><script>alert(1)</script>' }).applied).toEqual([]);
  });

  it('refuses a value containing a newline', () => {
    expect(applyThemeTokens({ '--color-base': '#fff\nposition: fixed' }).applied).toEqual([]);
  });

  it('refuses an empty value', () => {
    const result = applyThemeTokens({ '--color-base': '   ' });
    expect(result.applied).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/empty/);
  });

  it('reports every rejection through the callback', () => {
    const seen: string[] = [];
    applyThemeTokens({ '--evil': 'x', '--color-base': '' }, { onReject: (token) => seen.push(token) });
    expect(seen).toEqual(['--evil', '--color-base']);
  });

  it('applies the good tokens even when a bad one is present', () => {
    // A cosmetic plugin failing entirely because one colour is malformed would be
    // a worse outcome than a partly applied theme.
    const result = applyThemeTokens({ '--color-base': '#101010', '--evil': 'x' });
    expect(result.applied).toEqual(['--color-base']);
    expect(result.rejected).toHaveLength(1);
  });

  it('does nothing for an absent token map', () => {
    expect(applyThemeTokens(undefined).applied).toEqual([]);
    expect(applyThemeTokens(null).applied).toEqual([]);
  });
});

describe('clearThemeTokens', () => {
  it('removes applied tokens so the stylesheet default returns', () => {
    applyThemeTokens({ '--color-base': '#101010', '--color-accent': '#ff0000' });
    expect(root().style.getPropertyValue('--color-base')).toBe('#101010');

    const cleared = clearThemeTokens(root());
    expect(cleared).toContain('--color-base');
    expect(root().style.getPropertyValue('--color-base')).toBe('');
    expect(root().style.getPropertyValue('--color-accent')).toBe('');
  });

  it('is safe to call when nothing is set', () => {
    expect(() => clearThemeTokens(root())).not.toThrow();
  });
});