/**
 * Application shell.
 *
 * **Three** columns: the permanent icon rail, the session column, and the mode's work area
 * (always `1fr`). The icon rail is fixed at `--rail-icon-w`, because a strip whose whole job
 * is to stay put is not one the user should be able to drag shut. The session column also
 * closes to 0 rather than to a strip — see `railWidth`.
 *
 * ## The right drawer
 *
 * The fourth track is the right drawer (`RightRail`). It stays at width 0 until the
 * mode header's single panel toggle opens it. Artifacts, memory, context and the
 * other run sections are tabs inside that drawer, not icons in the header.
 *
 * One row, four columns, and no left-side footer: the account entry belongs to the icon
 * rail, which is the only left-side surface that never collapses. Putting it anywhere else
 * means either two avatars on screen at once or none in some layout.
 *
* ## The bottom strip
 *
* `StatusBar` is absolutely positioned across the full window width and the grid reserves
 * room for it with `padding-bottom` — the same relationship `TopBar` has with
 * `padding-top`. That is deliberate: the strip crosses all four columns, so it cannot be a
 * column, and it must not be a second grid row. An earlier attempt at a left-hand footer
 * did add a row, and the cost was a composer lifted ~68px and a right-rail divider cut in
 * two — with the strip reserved as padding, neither can happen.
 *
 * ## Top bar visibility
 *
 * The bar is an overlay, so it can be out of the way. What it carries is brand, connection,
 * and window controls — none of which is a running task's progress readout:
 *
 * | `localPrefs.topBar` | when            |
 * |---------------------|-----------------|
 * | `pinned`            | always visible  |
 * | `auto`              | follows the pointer at the top edge |
 * | `hidden`            | never           |
 *
 * There used to be a fourth rule: a task in flight forced `auto` to stay visible, because the
 * bar carried the progress rail. The rail is gone, so the rule went with it. That is a real
 * change — a task running no longer reclaims the bar — and it is the right one now that the
 * bar has nothing to say about the task. Progress lives in the mode header's lifecycle
 * stepper, which is never hidden at all.
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { CommandErrorNotice } from './components/CommandErrorNotice.js';
import { Composer } from './components/Composer.js';
import { EngineBanner } from './components/EngineBanner.js';
import { IconRail } from './components/IconRail.js';
import { RailDivider } from './components/RailDivider.js';
import { RightRail } from './components/RightRail.js';
import { RunDock } from './components/RunDock.js';
import { SessionRail } from './components/SessionRail.js';
import { SettingsDrawer } from './components/SettingsDrawer.js';
import { StatusBar, STATUS_BAR_H } from './components/StatusBar.js';
import { SteeringForm } from './components/SteeringForm.js';
import { TopBar } from './components/TopBar.js';
import { WindowEdges } from './components/WindowEdges.js';
import { RAIL_ICON_WIDTH, railWidth } from './state/local-prefs.js';
import { useUiStore } from './state/UiProvider.js';
import { ModeShell } from './modes/ModeShell.js';
import { readModelSettings } from './window/model-settings.js';
import { isFreshChatSession } from './state/fresh-session.js';
import { useMode } from './mode/useMode.js';
import { t } from './i18n/strings.js';

/** Height of the overlay bar in px — also the grid's top padding when it is visible. */
export const TOP_BAR_H = 44;

export function App(): ReactNode {
  const prefs = useUiStore((s) => s.localPrefs);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const [revealed, setRevealed] = useState(prefs.topBar === 'pinned');
  const hideTimer = useRef<number | null>(null);
  const prefsRef = useRef(prefs);
  const settingsRef = useRef(settingsOpen);
  prefsRef.current = prefs;
  settingsRef.current = settingsOpen;

  const clearHide = (): void => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const showTopBar = (): void => {
    if (prefsRef.current.topBar === 'hidden') return;
    clearHide();
    setRevealed(true);
  };

  const scheduleHide = (): void => {
    if (prefsRef.current.topBar === 'pinned') return;
    clearHide();
    hideTimer.current = window.setTimeout(() => setRevealed(false), 400);
  };

  /**
   * Reconcile the plan-approval control with the persisted policy, once at boot.
   *
   * `~/.camelia/config.json` is the durable store, the shell seeds it on first run, and the
   * engine reads it at spawn — so the *engine* needs no help from here. This only keeps the
   * Settings dropdown honest: `localPrefs.planApproval` is window-local, and without this
   * the control could show `auto` while the engine was running `always`, silently.
   *
   * A missing value is left alone rather than overwritten. Absence means "this install has
   * not chosen", and writing a default over it would report a decision instead of a default.
   */
  const bootSynced = useRef(false);
  useEffect(() => {
    if (bootSynced.current) return;
    bootSynced.current = true;
    void readModelSettings().then((settings) => {
      const persisted = settings?.planApproval;
      if (!persisted || prefsRef.current.planApproval === persisted) return;
      setLocalPrefs({ planApproval: persisted });
    });
  }, [setLocalPrefs]);

  useEffect(() => {
    if (prefs.topBar === 'pinned') setRevealed(true);
    if (prefs.topBar === 'hidden') setRevealed(false);
  }, [prefs.topBar]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (settingsRef.current) {
          setSettingsOpen(false);
          return;
        }
        scheduleHide();
        return;
      }
      if (event.ctrlKey && event.code === 'Backquote') {
        event.preventDefault();
        clearHide();
        setRevealed(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSettingsOpen]);

  /* Native Chromium/Tauri right-click menu (Copy / Print / Inspect) looks wrong in-app. */
  useEffect(() => {
    const blockNativeMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };
    document.addEventListener('contextmenu', blockNativeMenu);
    return () => document.removeEventListener('contextmenu', blockNativeMenu);
  }, []);


  const left = railWidth(prefs);
  const panelId = useUiStore((s) => s.panelId);
  const right = panelId ? prefs.rightWidth : 0;
  const topVisible = prefs.topBar === 'hidden' ? false : prefs.topBar === 'pinned' || revealed;
  const snapshot = useUiStore((s) => s.snapshot);
  const transportError = useUiStore((s) => s.transportError);
  const lang = useUiStore((s) => s.localPrefs.language);
  const { mode } = useMode();
  // Transport failures must keep the error surface visible — not the centred empty hero.
  const fresh = mode === 'work' && isFreshChatSession(snapshot) && !transportError;
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);

  return (
    <div
      data-shell
      className="relative h-screen overflow-hidden bg-base text-ink"
      style={{
        ['--rail-icon-w' as string]: `${RAIL_ICON_WIDTH}px`,
        ['--rail-left-w' as string]: `${left}px`,
        ['--rail-right-w' as string]: `${right}px`,
        ['--top-bar-h' as string]: `${TOP_BAR_H}px`,
        ['--status-bar-h' as string]: `${STATUS_BAR_H}px`,
      }}
    >
      <div
        className="camelia-rails grid h-full min-h-0"
        style={{
          gridTemplateColumns:
            'var(--rail-icon-w) var(--rail-left-w) minmax(0, 1fr) var(--rail-right-w)',
          paddingTop: topVisible ? TOP_BAR_H : 0,
          /*
            The status bar is absolutely positioned across the full window width — the way
            VS Code's is, under the activity bar and both panels — so the grid reserves room
            for it as padding instead of adding a row. A second row is what an earlier
            left-footer attempt did, and it lifted the composer and cut the right rail's
            divider; a strip that crosses every column cannot be a column.
          */
          paddingBottom: STATUS_BAR_H,
        }}
      >
        <IconRail />
        <SessionRail />
        <main className="flex min-h-0 min-w-0 flex-col">
          <EngineBanner />
          <ModeShell />
          {!fresh ? <SteeringForm /> : null}
          {!fresh ? <CommandErrorNotice /> : null}
          {!fresh ? <RunDock /> : null}
          {/*
            Fresh Work session: ChatGPT-style — greeting + composer centred in the pane.
            Once turns or a task exist, the composer docks under the transcript again.
          */}
          <div
            data-composer-slot={fresh ? 'centered' : 'docked'}
            className={
              fresh
                ? 'flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-10'
                : 'shrink-0'
            }
          >
            {fresh ? (
              <div className="mb-5 max-w-md text-center" data-chat-empty-hero>
                <p className="text-[15px] font-medium text-ink">{tr('welcome.title')}</p>
                <p className="mt-1.5 text-[12.5px] leading-5 text-ink-3">{tr('chat.empty')}</p>
              </div>
            ) : null}
            <div className={fresh ? 'w-full max-w-3xl' : undefined}>
              <Composer centered={fresh} />
            </div>
          </div>
        </main>
        <RightRail />
      </div>

      <RailDivider />

      {/* Below the drag region and above the rails; `WindowEdges` is raised above it so
          the bottom resize handle is not swallowed by a 22px strip. */}
      <StatusBar />

      <div
        className="absolute inset-x-0 top-0 z-50 h-2"
        data-tauri-drag-region
        onMouseEnter={showTopBar}
        onMouseLeave={scheduleHide}
      />
      <div onMouseEnter={showTopBar} onMouseLeave={scheduleHide}>
        <TopBar revealed={topVisible} />
      </div>

      <WindowEdges />
      <SettingsDrawer />
    </div>
  );
}
