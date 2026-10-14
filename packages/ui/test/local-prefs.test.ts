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
  railWidth,
  sanitizeLocalPrefs,
  saveLocalPrefs,
  type LocalPrefs,
} from '../src/state/local-prefs.js';
import { createUiStore } from '../src/state/store.js';
import { FixtureTransport } from '../src/transport/fixture.js';

describe('localPrefs', () => {
  it('clamps the session column into the drag range', () => {
    expect(clampRail(10)).toBe(200);
    expect(clampRail(900)).toBe(420);
    expect(clampRail(Number.NaN)).toBe(260);
  });

  it('reads a collapsed session column as 0, not as a strip', () => {
    expect(railWidth(sanitizeLocalPrefs({ leftWidth: 300 }))).toBe(300);
    expect(railWidth(sanitizeLocalPrefs({ leftWidth: 300, leftCollapsed: true }))).toBe(0);
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

  it('defaults the user avatar to the mascot when the install has no opinion', () => {
    // The point of the feature: "only use the mark if the user has not set one".
    // An older install has no `userAvatar` key at all, so it must land on the mascot —
    // and an unknown value must not leak through as a third state.
    expect(sanitizeLocalPrefs({}).userAvatar).toBe('mascot');
    expect(sanitizeLocalPrefs({ userAvatar: 'nope' as LocalPrefs['userAvatar'] }).userAvatar).toBe('mascot');
    expect(sanitizeLocalPrefs({ userAvatar: 'letter' }).userAvatar).toBe('letter');
    expect(sanitizeLocalPrefs({}).displayName).toBe('');
  });

  it('defaults plan approval to auto, and re-reads a pre-v5 `always` as unchosen', () => {
    // The desktop default: the plan is shown, not demanded. Risky tool calls keep their own
    // approval, so the plan gate is the review affordance and nothing else.
    expect(sanitizeLocalPrefs({}).planApproval).toBe('auto');

    // Before v5 this key defaulted to `always`, so every existing install has it stored
    // whether or not the user ever opened the control. That leftover is not an opt-in.
    expect(sanitizeLocalPrefs({ version: 4, planApproval: 'always' }).planApproval).toBe('auto');
    // From v5 on, `always` is a decision and is honoured.
    expect(sanitizeLocalPrefs({ version: 5, planApproval: 'always' }).planApproval).toBe('always');
    expect(sanitizeLocalPrefs({ version: 5, planApproval: 'auto' }).planApproval).toBe('auto');
    // Anything unrecognised takes the default rather than turning into a nag.
    expect(
      sanitizeLocalPrefs({ version: 5, planApproval: 'nope' as LocalPrefs['planApproval'] }).planApproval,
    ).toBe('auto');
  });

  it('round-trips through storage and stays out of the snapshot', () => {
    saveLocalPrefs({
      version: LOCAL_PREFS_VERSION,
      leftWidth: 300,
      leftCollapsed: true,
      rightWidth: 320,
      rightCollapsed: true,
      themeId: 'light',
      language: 'zh',
      topBar: 'pinned',
      motion: 'reduce',
      fontMono: 'Consolas, monospace',
      planApproval: 'always',
      preferredMode: 'work',
      showAvatars: false,
      userAvatar: 'letter',
      githubAccount: null,
      displayName: '阿离',
      chatPolicy: 'ask',
      effort: 'high',
      feedbackRepo: '',
      includeFeedbackMeta: true,
      installDir: '',
      workspaceDir: '',
    });
    const store = createUiStore(new FixtureTransport({ scene: 'empty' }));
    expect(store.getState().localPrefs.leftWidth).toBe(300);
    expect(store.getState().localPrefs.leftCollapsed).toBe(true);
    expect(store.getState().localPrefs.themeId).toBe('light');
    // The mode preference is ordinary window chrome: it persists across boots.
    expect(store.getState().localPrefs.preferredMode).toBe('work');
    expect(store.getState().localPrefs.showAvatars).toBe(false);
    expect(store.getState().localPrefs.userAvatar).toBe('letter');
    expect(store.getState().localPrefs.displayName).toBe('阿离');
    // The chat permission posture is window-local chrome too — it round-trips.
    expect(store.getState().localPrefs.chatPolicy).toBe('ask');
    expect(store.getState().snapshot.task).toBeUndefined();
    expect(loadLocalPrefs().topBar).toBe('pinned');
    // Pinned deliberately: if the Ink Light palette moves, this test must fail so the
    // change is looked at rather than absorbed. #fafafa is the base token shipped by
    // the `light` preset (Hermes' --bg-primary).
    expect(document.documentElement.style.getPropertyValue('--color-base')).toBe('#fafafa');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('drops the removed right-rail keys on boot instead of migrating them', () => {
    // v6 removed the right rail. A stored blob still carries `rightWidth` /
    // `rightCollapsed` / `userSetRightRail`; they must not survive into the live prefs,
    // and the rewritten blob must not carry them either.
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        version: 5,
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
    const booted = loadLocalPrefs();
    expect(booted.version).toBe(LOCAL_PREFS_VERSION);
    expect(booted.leftWidth).toBe(300);

    const stored = JSON.parse(localStorage.getItem('camelia.localPrefs')!) as Record<string, unknown>;
    expect(stored.version).toBe(LOCAL_PREFS_VERSION);
    expect(stored).toHaveProperty('rightWidth');
    expect(stored.rightCollapsed).toBe(true);
    expect(stored).not.toHaveProperty('userSetRightRail');

    // A second boot is already clean, so it rewrites nothing. The rewrite must be
    // idempotent or every launch would dirty localStorage forever.
    const before = localStorage.getItem('camelia.localPrefs');
    loadLocalPrefs();
    expect(localStorage.getItem('camelia.localPrefs')).toBe(before);
  });

  it('repairs a blob whose sanitized form differs, without a version bump', () => {
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        version: LOCAL_PREFS_VERSION,
        leftWidth: 9999, // out of the drag range
        leftCollapsed: false,
        themeId: 'nope',
        language: 'zh',
        topBar: 'pinned',
        motion: 'system',
        fontMono: '',
        planApproval: 'auto',
      }),
    );
    const repaired = loadLocalPrefs();
    expect(repaired.leftWidth).toBe(420);
    expect(repaired.themeId).toBe('light');
    const stored = JSON.parse(localStorage.getItem('camelia.localPrefs')!) as Record<string, unknown>;
    expect(stored.leftWidth).toBe(420);
    expect(stored.themeId).toBe('light');
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
