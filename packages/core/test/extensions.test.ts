import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_ID,
  filterThemeTokens,
  isSafeTokenValue,
  isUnsafeRelativePath,
  missingPermissions,
  parseAgentPreset,
  parsePluginManifest,
  parseShellPlugin,
  parseThemePlugin,
  permissionsForRisk,
  presetAllows,
  THEME_TOKEN_WHITELIST,
  type AgentPreset,
} from '../src/index.js';

describe('parsePluginManifest', () => {
  it('accepts a well-formed manifest and defaults permissions to none', () => {
    const result = parsePluginManifest({ name: 'my-plugin', kind: 'tool', entry: 'index.js' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('my-plugin');
    expect(result.value.kind).toBe('tool');
    expect(result.value.permissions).toEqual([]);
  });

  it('collects every issue rather than throwing on the first', () => {
    const result = parsePluginManifest({ name: '', kind: 'nope', entry: '../escape.js' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('name');
    expect(paths).toContain('kind');
    expect(paths).toContain('entry');
  });

  it('rejects a non-object manifest', () => {
    const result = parsePluginManifest('not an object');
    expect(result.ok).toBe(false);
  });

  it('rejects unknown permissions and keeps the known ones', () => {
    const result = parsePluginManifest({
      name: 'p',
      kind: 'tool',
      entry: 'index.js',
      permissions: ['fs:read', 'root:everything'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === 'permissions[1]')).toBe(true);
  });

  it('rejects a non-array permissions field', () => {
    const result = parsePluginManifest({ name: 'p', kind: 'tool', entry: 'i.js', permissions: 'fs:read' });
    expect(result.ok).toBe(false);
  });

  it('requires version/description to be strings when present', () => {
    const result = parsePluginManifest({ name: 'p', kind: 'theme', entry: 't.json', version: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === 'version')).toBe(true);
  });

  it('trims the name and entry', () => {
    const result = parsePluginManifest({ name: '  spaced  ', kind: 'provider', entry: '  x.js  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('spaced');
    expect(result.value.entry).toBe('x.js');
  });
});

describe('isUnsafeRelativePath', () => {
  it('accepts ordinary relative paths', () => {
    expect(isUnsafeRelativePath('index.js')).toBe(false);
    expect(isUnsafeRelativePath('dist/tool.mjs')).toBe(false);
  });

  it('rejects traversal, absolute and drive-letter paths', () => {
    expect(isUnsafeRelativePath('../secrets')).toBe(true);
    expect(isUnsafeRelativePath('a/../../b')).toBe(true);
    expect(isUnsafeRelativePath('/etc/passwd')).toBe(true);
    expect(isUnsafeRelativePath('\\windows')).toBe(true);
    expect(isUnsafeRelativePath('C:/Windows')).toBe(true);
  });
});

describe('permissionsForRisk / missingPermissions', () => {
  it('maps each risk level to the capability it implies', () => {
    expect(permissionsForRisk('read-only')).toEqual(['fs:read']);
    expect(permissionsForRisk('write')).toEqual(['fs:read', 'fs:write']);
    expect(permissionsForRisk('destructive')).toEqual(['fs:read', 'fs:write']);
    expect(permissionsForRisk('network')).toEqual(['net']);
    expect(permissionsForRisk('privileged')).toEqual(['shell:exec']);
  });

  it('reports the gap between declared permissions and what a tool needs', () => {
    expect(missingPermissions('write', ['fs:read', 'fs:write'])).toEqual([]);
    expect(missingPermissions('write', ['fs:read'])).toEqual(['fs:write']);
    expect(missingPermissions('privileged', [])).toEqual(['shell:exec']);
  });
});

describe('presetAllows', () => {
  const preset = (allowedTools: string[]): AgentPreset => ({
    id: 'p',
    label: 'P',
    systemPrompt: 'x',
    allowedTools,
    plannerMode: 'fast',
    modelPreference: {},
  });

  it("treats ['*'] as every tool", () => {
    expect(presetAllows(preset(['*']), 'fs.write')).toBe(true);
  });

  it('only permits listed tools otherwise', () => {
    expect(presetAllows(preset(['fs.read']), 'fs.read')).toBe(true);
    expect(presetAllows(preset(['fs.read']), 'fs.write')).toBe(false);
  });
});

describe('parseAgentPreset', () => {
  it('fills label from id and defaults plannerMode to full', () => {
    const result = parseAgentPreset({ id: 'coder', systemPrompt: 'be careful', allowedTools: ['*'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('coder');
    expect(result.value.plannerMode).toBe('full');
    expect(result.value.modelPreference).toEqual({});
  });

  it('requires allowedTools — a preset that forgets it must not silently allow everything', () => {
    const result = parseAgentPreset({ id: 'p', systemPrompt: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === 'allowedTools')).toBe(true);
  });

  it('validates plannerMode and modelPreference shape', () => {
    const result = parseAgentPreset({
      id: 'p',
      systemPrompt: 'x',
      allowedTools: [],
      plannerMode: 'turbo',
      modelPreference: { decision: 7 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('plannerMode');
    expect(paths).toContain('modelPreference.decision');
  });

  it('keeps model preferences when valid', () => {
    const result = parseAgentPreset({
      id: 'p',
      systemPrompt: 'x',
      allowedTools: ['fs.read'],
      modelPreference: { decision: 'big', grunt: 'small' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.modelPreference).toEqual({ decision: 'big', grunt: 'small' });
  });
});

describe('isSafeTokenValue', () => {
  it('accepts plain colours and lengths', () => {
    expect(isSafeTokenValue('#1A1514')).toBe(true);
    expect(isSafeTokenValue('rgba(217, 108, 95, 0.4)')).toBe(true);
    expect(isSafeTokenValue('10px')).toBe(true);
  });

  it('refuses values that could escape a declaration', () => {
    expect(isSafeTokenValue('red; } body { background: black')).toBe(false);
    expect(isSafeTokenValue('url(http://evil)')).toBe(false);
    expect(isSafeTokenValue('@import "x"')).toBe(false);
    expect(isSafeTokenValue('expression(alert(1))')).toBe(false);
    expect(isSafeTokenValue('a'.repeat(200))).toBe(false);
  });
});

describe('filterThemeTokens', () => {
  it('keeps whitelisted safe tokens and reports the rest', () => {
    const { tokens, rejected } = filterThemeTokens({
      '--color-accent': '#D96C5F',
      '--evil-token': 'red',
      '--color-ink': 'red;}',
    });
    expect(tokens).toEqual({ '--color-accent': '#D96C5F' });
    expect(rejected.sort()).toEqual(['--color-ink', '--evil-token']);
  });
});

describe('parseShellPlugin', () => {
  it('accepts the math-mode shell payload', () => {
    const result = parseShellPlugin({ mode: 'math', icon: 'sigma' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe('math');
  });

  it('rejects unknown modes and icons', () => {
    expect(parseShellPlugin({ mode: 'term', icon: 'sigma' }).ok).toBe(false);
    expect(parseShellPlugin({ mode: 'math', icon: 'bot' }).ok).toBe(false);
  });
});

describe('parseThemePlugin', () => {
  it('accepts a theme that only overrides whitelisted tokens', () => {
    const result = parseThemePlugin({ id: 'mine', label: 'Mine', tokens: { '--color-base': '#101010' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe('Mine');
    expect(result.value.tokens).toEqual({ '--color-base': '#101010' });
  });

  it('rejects a theme that tries to inject a non-whitelisted or unsafe token', () => {
    const result = parseThemePlugin({ id: 'mine', tokens: { '--color-base': '#101010', '--x': 'red' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === 'tokens')).toBe(true);
  });

  it('rejects an empty token set', () => {
    const result = parseThemePlugin({ id: 'mine', tokens: {} });
    expect(result.ok).toBe(false);
  });

  it('requires an id', () => {
    const result = parseThemePlugin({ tokens: { '--color-base': '#101010' } });
    expect(result.ok).toBe(false);
  });

  it('ships a non-empty whitelist and a default theme id', () => {
    expect(THEME_TOKEN_WHITELIST.length).toBeGreaterThan(10);
    expect(DEFAULT_THEME_ID).toBe('camellia-dark');
  });
});