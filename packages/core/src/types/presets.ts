/**
 * Agent presets and theme tokens — the two *data-only* extension points.
 *
 * Neither of these executes code, so both are pure JSON contracts: a preset is a
 * persona (prompt + tool allowlist + model preference), a theme is a set of CSS
 * custom properties. Because they never run, the loader can accept them without
 * an isolation boundary — but a theme still may not inject arbitrary CSS, so its
 * values pass a strict token whitelist (whitepaper §8.3, §8.4).
 * @module
 */

import type { ParseResult, PluginManifestIssue } from './plugins.js';

// ---------------------------------------------------------------------------
// Agent presets (whitepaper §8.3)
// ---------------------------------------------------------------------------

/**
 * A persona: which prompt the model gets, which tools it may call, and which
 * models do the thinking vs. the grunt work.
 *
 * `modelPreference` is what makes multi-model collaboration a *configuration*
 * rather than a code path: a preset can send planning to a strong model and
 * summarisation to a cheap one (whitepaper §4.8, §5.1).
 */
export interface AgentPreset {
  id: string;
  label: string;
  description?: string;
  /** Persona directives appended to the planner and executor system prompts. */
  systemPrompt: string;
  /** Tool names this preset may call. `['*']` means every registered tool. */
  allowedTools: string[];
  plannerMode: 'fast' | 'full';
  modelPreference: { decision?: string; grunt?: string };
}

/** True when a preset may call a tool. A `'*'` allowlist permits everything. */
export function presetAllows(preset: AgentPreset, toolName: string): boolean {
  return preset.allowedTools.includes('*') || preset.allowedTools.includes(toolName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate an unknown value into an {@link AgentPreset}, collecting all issues. */
export function parseAgentPreset(raw: unknown): ParseResult<AgentPreset> {
  const issues: PluginManifestIssue[] = [];
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ path: '', message: 'preset must be a JSON object' }] };
  }

  const id = raw.id;
  if (typeof id !== 'string' || !id.trim()) {
    issues.push({ path: 'id', message: 'id must be a non-empty string' });
  }
  const label = raw.label;
  if (label !== undefined && typeof label !== 'string') {
    issues.push({ path: 'label', message: 'label must be a string when present' });
  }
  const systemPrompt = raw.systemPrompt;
  if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
    issues.push({ path: 'systemPrompt', message: 'systemPrompt must be a non-empty string' });
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    issues.push({ path: 'description', message: 'description must be a string when present' });
  }

  const allowedTools: string[] = [];
  if (raw.allowedTools === undefined) {
    issues.push({ path: 'allowedTools', message: 'allowedTools is required (use ["*"] for all tools)' });
  } else if (!Array.isArray(raw.allowedTools) || raw.allowedTools.some((t) => typeof t !== 'string')) {
    issues.push({ path: 'allowedTools', message: 'allowedTools must be an array of tool names' });
  } else {
    allowedTools.push(...(raw.allowedTools as string[]));
  }

  const plannerMode = raw.plannerMode ?? 'full';
  if (plannerMode !== 'fast' && plannerMode !== 'full') {
    issues.push({ path: 'plannerMode', message: "plannerMode must be 'fast' or 'full'" });
  }

  const preference: { decision?: string; grunt?: string } = {};
  if (raw.modelPreference !== undefined) {
    if (!isRecord(raw.modelPreference)) {
      issues.push({ path: 'modelPreference', message: 'modelPreference must be an object' });
    } else {
      for (const slot of ['decision', 'grunt'] as const) {
        const value = raw.modelPreference[slot];
        if (value !== undefined && typeof value !== 'string') {
          issues.push({ path: `modelPreference.${slot}`, message: `${slot} must be a string when present` });
        } else if (typeof value === 'string') {
          preference[slot] = value;
        }
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      id: (id as string).trim(),
      label: typeof label === 'string' && label.trim() ? label.trim() : (id as string).trim(),
      description: typeof raw.description === 'string' ? raw.description : undefined,
      systemPrompt: (systemPrompt as string).trim(),
      allowedTools,
      plannerMode: plannerMode as 'fast' | 'full',
      modelPreference: preference,
    },
  };
}

// ---------------------------------------------------------------------------
// Themes (whitepaper §8.4)
// ---------------------------------------------------------------------------

/**
 * CSS custom properties a theme may override.
 *
 * Must stay in sync with the `@theme` block in `packages/ui/src/index.css`. A
 * theme is user-supplied data injected into the document, so the surface is a
 * closed list rather than "any custom property".
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

export type ThemeToken = (typeof THEME_TOKEN_WHITELIST)[number];
export type ThemeTokens = Record<string, string>;

export interface ThemePlugin {
  id: string;
  label: string;
  tokens: ThemeTokens;
}

/** Longest value we will accept — a theme is a colour, not a stylesheet. */
const MAX_TOKEN_VALUE_LENGTH = 120;

/**
 * Reject values that could break out of a declaration and inject CSS.
 *
 * Setting a custom property is safe *only* if the value cannot terminate the
 * declaration or open a new rule. `;`, `}`, `{`, `url(` and `@` are all ways out,
 * so any value containing them is refused rather than escaped — escaping CSS by
 * hand is a losing game.
 */
export function isSafeTokenValue(value: string): boolean {
  if (value.length > MAX_TOKEN_VALUE_LENGTH) return false;
  if (/[;{}<>]/.test(value)) return false;
  if (/url\s*\(/i.test(value)) return false;
  if (value.includes('@')) return false;
  if (value.includes('expression(')) return false;
  return true;
}

/** Split theme tokens into the whitelisted ones and the rejected ones. */
export function filterThemeTokens(tokens: ThemeTokens): { tokens: ThemeTokens; rejected: string[] } {
  const allowed: ThemeTokens = {};
  const rejected: string[] = [];
  for (const [name, value] of Object.entries(tokens)) {
    if (!(THEME_TOKEN_WHITELIST as readonly string[]).includes(name)) {
      rejected.push(name);
      continue;
    }
    if (typeof value !== 'string' || !isSafeTokenValue(value)) {
      rejected.push(name);
      continue;
    }
    allowed[name] = value;
  }
  return { tokens: allowed, rejected };
}

/** Validate an unknown value into a {@link ThemePlugin}, collecting all issues. */
export function parseThemePlugin(raw: unknown): ParseResult<ThemePlugin> {
  const issues: PluginManifestIssue[] = [];
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ path: '', message: 'theme must be a JSON object' }] };
  }

  const id = raw.id;
  if (typeof id !== 'string' || !id.trim()) {
    issues.push({ path: 'id', message: 'id must be a non-empty string' });
  }
  const label = raw.label;
  if (label !== undefined && typeof label !== 'string') {
    issues.push({ path: 'label', message: 'label must be a string when present' });
  }
  if (!isRecord(raw.tokens)) {
    issues.push({ path: 'tokens', message: 'tokens must be an object of CSS custom properties' });
    return { ok: false, issues };
  }

  const { tokens, rejected } = filterThemeTokens(raw.tokens as ThemeTokens);
  if (rejected.length > 0) {
    issues.push({
      path: 'tokens',
      message: `refused non-whitelisted or unsafe token(s): ${rejected.join(', ')}`,
    });
  }
  if (Object.keys(tokens).length === 0 && rejected.length === 0) {
    issues.push({ path: 'tokens', message: 'theme must define at least one token' });
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      id: (id as string).trim(),
      label: typeof label === 'string' && label.trim() ? label.trim() : (id as string).trim(),
      tokens,
    },
  };
}

/** The built-in theme id — what the app uses when no theme plugin is active. */
export const DEFAULT_THEME_ID = 'camellia-dark';