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
    expect(document.documentElement.style.getPropertyValue('--color-base')).toBe('#f6f1ec');
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
