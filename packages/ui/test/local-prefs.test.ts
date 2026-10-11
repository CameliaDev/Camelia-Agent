/**
 * Window-local preferences. They must round-trip without touching the snapshot.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { applyThemeTokens } from '../src/theme/apply-theme.js';
import {
  LOCAL_PREFS_VERSION,
  clampRail,
  loadLocalPrefs,
  sanitizeLocalPrefs,
  saveLocalPrefs,
  rightRailUserPatch,
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
      version: LOCAL_PREFS_VERSION,
      leftWidth: 300,
      rightWidth: 400,
      leftCollapsed: true,
      rightCollapsed: false,
      userSetRightRail: true,
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
    expect(store.getState().localPrefs.rightCollapsed).toBe(false);
    expect(store.getState().localPrefs.userSetRightRail).toBe(true);
    expect(store.getState().snapshot.task).toBeUndefined();
    expect(loadLocalPrefs().topBar).toBe('pinned');
    expect(document.documentElement.style.getPropertyValue('--color-base')).toBe('#f3f0ed');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('migrates pre-v3 prefs (including stuck v2 expanded) to a collapsed right rail', () => {
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
    expect(migrated.version).toBe(3);
    expect(migrated.rightCollapsed).toBe(true);
    expect(migrated.userSetRightRail).toBe(false);
    expect(migrated.leftWidth).toBe(300);
    const stored = JSON.parse(localStorage.getItem('camelia.localPrefs')!);
    expect(stored.version).toBe(3);
    expect(stored.rightCollapsed).toBe(true);

    // Stuck v2: version already 2 but still expanded (the bug 239e7f1 could not fix).
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        version: 2,
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
    const fromV2 = loadLocalPrefs();
    expect(fromV2.version).toBe(3);
    expect(fromV2.rightCollapsed).toBe(true);
    expect(fromV2.userSetRightRail).toBe(false);

    saveLocalPrefs({ ...fromV2, ...rightRailUserPatch(false) });
    expect(loadLocalPrefs().rightCollapsed).toBe(false);
    expect(loadLocalPrefs().userSetRightRail).toBe(true);
  });

  it('ignores expanded state without userSetRightRail even at current version', () => {
    expect(sanitizeLocalPrefs({ version: 3, rightCollapsed: false }).rightCollapsed).toBe(true);
    expect(
      sanitizeLocalPrefs({ version: 3, rightCollapsed: false, userSetRightRail: true }).rightCollapsed,
    ).toBe(false);
    expect(
      sanitizeLocalPrefs({ version: 3, rightCollapsed: true, userSetRightRail: true }).rightCollapsed,
    ).toBe(true);
    expect(sanitizeLocalPrefs({}).rightCollapsed).toBe(true);
    expect(sanitizeLocalPrefs({ version: 2, rightCollapsed: false }).rightCollapsed).toBe(true);
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
