/**
 * Application shell.
 *
 * Three columns: sessions, the conversation (always `1fr`), and the run rail.
 * Widths come from `--rail-left-w` / `--rail-right-w` so a drag can change them.
 * The top bar is an overlay; an 8px strip keeps the window draggable when it is hidden.
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Composer } from './components/Composer.js';
import { Conversation } from './components/Conversation.js';
import { RailDivider } from './components/RailDivider.js';
import { RightRail } from './components/RightRail.js';
import { SessionRail } from './components/SessionRail.js';
import { SettingsDrawer } from './components/SettingsDrawer.js';
import { TopBar } from './components/TopBar.js';
import { WindowEdges } from './components/WindowEdges.js';
import { railWidth } from './state/local-prefs.js';
import { useUiStore } from './state/UiProvider.js';

export function App(): ReactNode {
  const prefs = useUiStore((s) => s.localPrefs);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
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

  const left = railWidth(prefs, 'left');
  const right = railWidth(prefs, 'right');
  const topVisible = prefs.topBar === 'pinned' || revealed;

  return (
    <div
      data-shell
      className="relative h-screen overflow-hidden bg-base text-ink"
      style={{
        ['--rail-left-w' as string]: `${left}px`,
        ['--rail-right-w' as string]: `${right}px`,
      }}
    >
      <div
        className="camelia-rails grid h-full min-h-0"
        style={{
          gridTemplateColumns: 'var(--rail-left-w) minmax(0, 1fr) var(--rail-right-w)',
          paddingTop: topVisible ? 36 : 0,
        }}
      >
        <SessionRail />
        <main className="flex min-h-0 min-w-0 flex-col">
          <Conversation />
          <Composer />
        </main>
        <RightRail />
      </div>

      <RailDivider side="left" />
      <RailDivider side="right" />

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
