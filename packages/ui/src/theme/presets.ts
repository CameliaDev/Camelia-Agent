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
    // Wireframe v2: low-fidelity grayscale line art on white, single blue accent.
    id: 'light',
    label: 'Light',
    tokens: {
      '--color-base': '#ffffff',
      '--color-elevated': '#f7f8fa',
      '--color-panel': '#eef0f4',
      '--color-hover': '#eceef2',
      '--color-line': '#e2e4ea',
      '--color-ink': '#1f2329',
      '--color-ink-2': '#4b5563',
      '--color-ink-3': '#8f959e',
      '--color-accent': '#2563eb',
      '--color-accent-2': '#3b82f6',
      '--color-accent-dim': '#dbeafe',
      '--color-ok': '#16a34a',
      '--color-bad': '#dc2626',
      '--color-warn': '#d97706',
      '--color-info': '#0284c7',
      '--color-add': 'rgba(22, 163, 74, 0.10)',
      '--color-del': 'rgba(220, 38, 38, 0.08)',
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
