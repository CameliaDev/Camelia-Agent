/**
 * Four built-in themes.
 *
 * The theme **ids** are historical and are deliberately left alone: `themeId` is
 * persisted in `localStorage`, so renaming an id would silently reset every existing
 * install's choice back to the default. `warm-dark` therefore now means *Ink Dark* —
 * the label is the user-facing truth.
 *
 * Palettes are ported from Hermes Studio's `黑白水墨 / Pure Ink` sheet
 * (`packages/client/src/styles/variables.scss`): `light` from that file's default
 * `:root` block, `warm-dark` from its `.dark` block (which lives in `index.css` as the
 * stylesheet default). `cool-dark` and `high-contrast` predate the port and are not
 * part of the ink family.
 *
 * Every key is already on `THEME_TOKEN_WHITELIST`. Warm Dark is the stylesheet
 * itself, so applying it clears inline overrides instead of re-stating them.
 * Switching calls `applyThemeTokens` — nothing here writes CSS by hand.
 * @module
 */

export type ThemeId = 'warm-dark' | 'cool-dark' | 'light' | 'high-contrast';

export interface ThemePreset {
  id: ThemeId;
  label: string;
  tokens: Record<string, string>;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    // id kept for storage compatibility; the palette is now neutral grey, not warm.
    id: 'warm-dark',
    label: 'Ink Dark',
    tokens: {},
  },
  {
    id: 'cool-dark',
    label: 'Cool Dark',
    tokens: {
      '--color-base': '#12161c',
      '--color-elevated': '#1a212b',
      '--color-panel': '#232b36',
      '--color-hover': '#2c3644',
      '--color-line': '#3a4656',
      '--color-ink': '#e8eef6',
      '--color-ink-2': '#b7c3d4',
      '--color-ink-3': '#7d8b9e',
      '--color-accent': '#6ea8d9',
      '--color-accent-2': '#8cbce6',
      '--color-accent-dim': '#3d6488',
      '--color-ok': '#6fa884',
      '--color-bad': '#d06a6a',
      '--color-warn': '#d4a85a',
      '--color-info': '#7eb0d4',
      '--color-add': 'rgba(111, 168, 132, 0.16)',
      '--color-del': 'rgba(208, 106, 106, 0.16)',
    },
  },
  {
    // Hermes' default sheet: #fafafa paper, #333 ink, no hue anywhere.
    id: 'light',
    label: 'Ink Light',
    tokens: {
      '--color-base': '#fafafa',
      '--color-elevated': '#ffffff',
      '--color-panel': '#f5f5f5',
      '--color-hover': '#f0f0f0',
      '--color-line': '#e0e0e0',
      '--color-ink': '#1a1a1a',
      '--color-ink-2': '#666666',
      '--color-ink-3': '#999999',
      '--color-accent': '#333333',
      '--color-accent-2': '#1a1a1a',
      '--color-accent-dim': '#888888',
      '--color-ok': '#2e7d32',
      '--color-bad': '#c62828',
      '--color-warn': '#f57f17',
      // Deeper than the original #4a90d9, which only reached 3.34:1 against white
      // — under AA for the composer's 12.5px "Steer" pill, and only 3.16:1 as
      // `text-info` on the #fafafa paper. This value clears AA in both directions:
      // white on it, and it on paper.
      '--color-info': '#2b6cb0',
      '--color-add': 'rgba(46, 125, 50, 0.12)',
      '--color-del': 'rgba(198, 40, 40, 0.10)',
    },
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    tokens: {
      '--color-base': '#000000',
      '--color-elevated': '#0a0a0a',
      '--color-panel': '#141414',
      '--color-hover': '#1f1f1f',
      '--color-line': '#ffffff',
      '--color-ink': '#ffffff',
      '--color-ink-2': '#f2f2f2',
      '--color-ink-3': '#d0d0d0',
      '--color-accent': '#ffb000',
      '--color-accent-2': '#ffd56a',
      '--color-accent-dim': '#7a5a00',
      '--color-ok': '#00e676',
      '--color-bad': '#ff5252',
      '--color-warn': '#ffd740',
      '--color-info': '#40c4ff',
      '--color-add': 'rgba(0, 230, 118, 0.25)',
      '--color-del': 'rgba(255, 82, 82, 0.25)',
    },
  },
];

export function themeById(id: ThemeId): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.id === id) ?? THEME_PRESETS[0]!;
}

export function themeLabel(id: ThemeId): string {
  return themeById(id).label;
}

/** Token map for a preset. Warm Dark is empty so the stylesheet values show through. */
export function applyPreset(id: ThemeId): Record<string, string> {
  return { ...themeById(id).tokens };
}
