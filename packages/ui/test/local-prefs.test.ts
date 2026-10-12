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
    // boot policy: expand does not survive createUiStore / loadLocalPrefs
    expect(store.getState().localPrefs.rightCollapsed).toBe(true);
    expect(store.getState().localPrefs.userSetRightRail).toBe(false);
    expect(store.getState().snapshot.task).toBeUndefined();
    expect(loadLocalPrefs().topBar).toBe('pinned');
    expect(document.documentElement.style.getPropertyValue('--color-base')).toBe('#f3f0ed');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('boots collapsed even when sticky v3 expanded prefs are in storage', () => {
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
    expect(migrated.version).toBe(4);
    expect(migrated.rightCollapsed).toBe(true);
    expect(migrated.userSetRightRail).toBe(false);
    expect(migrated.leftWidth).toBe(300);
    const stored = JSON.parse(localStorage.getItem('camelia.localPrefs')!);
    expect(stored.version).toBe(4);
    expect(stored.rightCollapsed).toBe(true);

    // Stuck v3: version already 3 + userSetRightRail after smoke expand — must still boot collapsed.
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        version: 3,
        leftWidth: 300,
        rightWidth: 400,
        leftCollapsed: false,
        rightCollapsed: false,
        userSetRightRail: true,
        themeId: 'light',
        language: 'zh',
        topBar: 'pinned',
        motion: 'system',
        fontMono: '',
        planApproval: 'always',
      }),
    );
    const fromSticky = loadLocalPrefs();
    expect(fromSticky.version).toBe(4);
    expect(fromSticky.rightCollapsed).toBe(true);
    expect(fromSticky.userSetRightRail).toBe(false);

    // In-session expand still works via sanitize + save; next load boots collapsed again.
    saveLocalPrefs({ ...fromSticky, ...rightRailUserPatch(false) });
    expect(JSON.parse(localStorage.getItem('camelia.localPrefs')!).rightCollapsed).toBe(false);
    expect(loadLocalPrefs().rightCollapsed).toBe(true);
    expect(loadLocalPrefs().userSetRightRail).toBe(false);
  });

  it('sanitize allows in-session expand only at v4+ with userSetRightRail', () => {
    expect(sanitizeLocalPrefs({ version: 4, rightCollapsed: false }).rightCollapsed).toBe(true);
    expect(
      sanitizeLocalPrefs({ version: 4, rightCollapsed: false, userSetRightRail: true }).rightCollapsed,
    ).toBe(false);
    expect(
      sanitizeLocalPrefs({ version: 4, rightCollapsed: true, userSetRightRail: true }).rightCollapsed,
    ).toBe(true);
    // Pre-v4 sticky expand is ignored by sanitize too.
    expect(
      sanitizeLocalPrefs({ version: 3, rightCollapsed: false, userSetRightRail: true }).rightCollapsed,
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
