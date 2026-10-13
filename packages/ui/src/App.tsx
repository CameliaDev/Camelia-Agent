/**
 * Application shell.
 *
 * **Three** columns: the permanent icon rail, the session column, and the mode's work area
 * (always `1fr`). The icon rail is fixed at `--rail-icon-w`, because a strip whose whole job
 * is to stay put is not one the user should be able to drag shut. The session column also
 * closes to 0 rather than to a strip — see `railWidth`.
 *
 * ## There was a fourth
 *
 * The data rail on the right is gone. Its six panels (memory, events, run, context,
 * sub-agents, model) are now icons in the mode header and their bodies open as a horizontal
 * deck in the work area — see `PanelIcons` and `PanelDeck`. The reason it went is recorded
 * on `RunPanels.tsx`; the structural consequence is here: `--rail-right-w` is no longer a
 * grid track, and `RailDivider` no longer has a `right` side.
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
import { PanelDeck } from './components/PanelDeck.js';
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

  const left = railWidth(prefs);
  const topVisible = prefs.topBar === 'hidden' ? false : prefs.topBar === 'pinned' || revealed;

  return (
    <div
      data-shell
      className="relative h-screen overflow-hidden bg-base text-ink"
      style={{
        ['--rail-icon-w' as string]: `${RAIL_ICON_WIDTH}px`,
        ['--rail-left-w' as string]: `${left}px`,
        ['--top-bar-h' as string]: `${TOP_BAR_H}px`,
        ['--status-bar-h' as string]: `${STATUS_BAR_H}px`,
      }}
    >
      <div
        className="camelia-rails grid h-full min-h-0"
        style={{
          gridTemplateColumns:
            'var(--rail-icon-w) var(--rail-left-w) minmax(0, 1fr)',
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
          {/*
            Feedback about the controls, drawn once for all three modes. Both used to live
            where only chat could see them — the steering form inside the transcript, the
            failed-command box beside it — so a pause the engine rejected showed nothing at
            all in plan and math. They sit with the composer because that is where the
            reader's attention is when a control they just used did not take.
          */}
          {/* The open run panel, 横着放 across the work area — see `PanelDeck`. */}
          <PanelDeck />
          <SteeringForm />
          <CommandErrorNotice />
          {/*
            The run dock — lifecycle stepper centred, pause/steer/stop right — drawn once
            here for all three modes, anchored to the composer where a run is read and
            intervened. The mode header keeps the session title and the panel icons.
          */}
          <RunDock />
          <Composer />
        </main>
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
