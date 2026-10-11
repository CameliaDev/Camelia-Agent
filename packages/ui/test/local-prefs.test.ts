/**
 * Window-local preferences. They must round-trip without touching the snapshot.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { applyThemeTokens } from '../src/theme/apply-theme.js';
import {
  clampRail,
  loadLocalPrefs,
  sanitizeLocalPrefs,
  saveLocalPrefs,
  type LocalPrefs,
} from '../src/state/local-prefs.js';
import { createUiStore } from '../src/state/store.js';
import { FixtureTransport } from '../src/transport/fixture.js';

describe('localPrefs', () => {
  it('clamps rail widths into the drag range', () => {
    expect(clampRail('left', 10)).toBe(200);
    expect(clampRail('left', 900)).toBe(420);
    expect(clampRail('right', 100)).toBe(280);
    expect(clampRail('right', 900)).toBe(560);
  });

  it('drops an unknown theme instead of inventing one', () => {
    const prefs = sanitizeLocalPrefs({ themeId: 'nope' as LocalPrefs['themeId'], leftWidth: 300 });
    expect(prefs.themeId).toBe('light');
    expect(prefs.leftWidth).toBe(300);
  });

  it('drops an unknown language and keeps a saved one', () => {
    expect(sanitizeLocalPrefs({ language: 'fr' as LocalPrefs['language'] }).language).toBe('zh');
    expect(sanitizeLocalPrefs({ language: 'en' }).language).toBe('en');
  });

  it('round-trips through storage and stays out of the snapshot', () => {
    saveLocalPrefs({
      version: 2,
      leftWidth: 300,
      rightWidth: 400,
      leftCollapsed: true,
      rightCollapsed: false,
      themeId: 'light',
      language: 'zh',
      topBar: 'pinned',
      motion: 'reduce',
      fontMono: 'Consolas, monospace',
      planApproval: 'always',
    });
    const store = createUiStore(new FixtureTransport({ scene: 'empty' }));
    expect(store.getState().localPrefs.leftWidth).toBe(300);
    expect(store.getState().localPrefs.themeId).toBe('light');
    expect(store.getState().snapshot.task).toBeUndefined();
    expect(loadLocalPrefs().topBar).toBe('pinned');
    expect(document.documentElement.style.getPropertyValue('--color-base')).toBe('#f3f0ed');
    expect(document.documentElement.dataset.theme).toBe('light');
  });


  it('migrates pre-v2 prefs to a collapsed right rail once', () => {
    // Simulate an old install that saved the previous default (expanded).
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        leftWidth: 300,
        rightWidth: 400,
        leftCollapsed: false,
        rightCollapsed: false,
        themeId: 'light',
        language: 'zh',
        topBar: 'pinned',
        motion: 'system',
        fontMono: '',
        planApproval: 'always',
      }),
    );
    const migrated = loadLocalPrefs();
    expect(migrated.version).toBe(2);
    expect(migrated.rightCollapsed).toBe(true);
    expect(migrated.leftWidth).toBe(300);
    // Persisted so a later user expand is not re-forced.
    const stored = JSON.parse(localStorage.getItem('camelia.localPrefs')!);
    expect(stored.version).toBe(2);
    expect(stored.rightCollapsed).toBe(true);

    // After migration, an explicit expand must stick.
    saveLocalPrefs({ ...migrated, rightCollapsed: false });
    expect(loadLocalPrefs().rightCollapsed).toBe(false);
  });

  it('keeps a post-v2 expanded right rail', () => {
    expect(sanitizeLocalPrefs({ version: 2, rightCollapsed: false }).rightCollapsed).toBe(false);
    expect(sanitizeLocalPrefs({ version: 2, rightCollapsed: true }).rightCollapsed).toBe(true);
    expect(sanitizeLocalPrefs({}).rightCollapsed).toBe(true);
  });

  it('shows a rejected token instead of dropping it silently', () => {
    const result = applyThemeTokens({ '--not-a-token': 'red' });
    const store = createUiStore(new FixtureTransport({ scene: 'empty' }));
    store.setState({
      activeTheme: { id: 'cool-dark', label: 'Cool Dark', rejected: result.rejected },
    });
    expect(store.getState().activeTheme?.rejected).toEqual([
      { token: '--not-a-token', reason: 'token is not on the whitelist' },
    ]);
  });
});
