/**
 * Four built-in themes.
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
    id: 'warm-dark',
    label: 'Warm Dark',
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
    id: 'light',
    label: 'Light',
    tokens: {
      '--color-base': '#f6f1ec',
      '--color-elevated': '#fffaf6',
      '--color-panel': '#efe6df',
      '--color-hover': '#e4d8cf',
      '--color-line': '#d4c4ba',
      '--color-ink': '#1a1514',
      '--color-ink-2': '#5c4e48',
      '--color-ink-3': '#8a746c',
      '--color-accent': '#3b7dd8',
      '--color-accent-2': '#5a9ae8',
      '--color-accent-dim': '#d6e4f7',
      '--color-ok': '#2d7a4a',
      '--color-bad': '#c42020',
      '--color-warn': '#9a6700',
      '--color-info': '#1d5f8a',
      '--color-add': 'rgba(61, 122, 74, 0.12)',
      '--color-del': 'rgba(180, 35, 24, 0.10)',
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
