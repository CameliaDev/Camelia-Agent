/**
 * Top bar — brand, mode, progress, connection.
 *
 * ## What changed in wireframe v3
 *
 * v2's bar was a brand placeholder, a session title and a connection badge, with a large
 * empty middle. It also carried two pieces of wireframe scaffolding — an orange dashed
 * capsule reading "名称与吉祥物 TBD" and a "按需滑出" tag — which are annotation, not
 * product. Those are gone; the middle is now the mode selector and the progress rail.
 *
 * ## What is no longer here
 *
 * Two things used to be in this bar and both were asked to move:
 *
 * - **The mode selector.** It is in the composer now (`ModeTabs` is rendered by
 *   `Composer`), because the mode decides what a keystroke in the input *means*, and the
 *   input is where the user is already looking. A mode switcher 40px above the box it
 *   changes the meaning of is a context switch the eye has to travel to catch up with.
 * - **The percentage rail and its microcopy** (`TaskProgressBar` + `ProgressMicrocopy`).
 *   Gone entirely, along with the conditional copy of the same rail in `ModeHeader` that
 *   existed only to cover for `topBar: 'hidden'`. What remains is the lifecycle stepper in
 *   `ModeHeader`: four named stops that answer *which stage*, which is the question a
 *   reader of a strip this short can actually act on. A continuous percentage is better
 *   answered by the step list in the run panel, where each step has its own state —
 *   one number for the whole run said less than the list it was summarising.
 *
 * What the bar still is: brand, connection, window controls, and the drag region.
 *
 * ## Visibility policy
 *
 * The bar is an overlay that can slide away (`localPrefs.topBar`). Nothing on it is a
 * progress readout any more, so the "forced visible while a task runs" rule has nothing to
 * protect and is gone with the rail: `auto` now genuinely means auto.
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { CONNECTION_META, TONE_TEXT } from '../lib/status.js';
import { useUiState } from '../state/UiProvider.js';
import { isTauri, windowClose, windowMinimize, windowStartDragging, windowToggleMaximize } from '../window/shell.js';
import { openEngineLog, readEngineTrust } from '../window/engine.js';
import { relaunchDesktop } from '../window/model-settings.js';
import { t } from '../i18n/strings.js';
import { Icon, Mascot, StatusDot } from './primitives.js';
import { ModeTabs } from '../mode/ModeTabs.js';
import { useMode } from '../mode/useMode.js';

export function TopBar({ revealed }: { revealed: boolean }): ReactNode {
  const { status, localPrefs, setSettingsOpen } = useUiState();
  const { mode, setMode } = useMode();
  const connection = CONNECTION_META[status];
  const desktop = isTauri();
  const tr = (k: Parameters<typeof t>[1]) => t(localPrefs.language, k);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!panelOpen) return;
    const onPointer = (event: MouseEvent): void => {
      if (!panelRef.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [panelOpen]);

  const onMouseDown = (event: React.MouseEvent<HTMLElement>): void => {
    // Let interactive elements handle their own clicks; drag everything else on the bar.
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.button !== 0) return;
    void windowStartDragging();
  };

  return (
    <header
      className={`camelia-topbar absolute inset-x-0 top-0 z-40 flex h-11 items-center gap-2 border-b border-line bg-base px-3 text-[12px] ${
        revealed ? 'translate-y-0' : 'pointer-events-none -translate-y-full'
      }`}
      data-tauri-drag-region
      onMouseDown={onMouseDown}
      aria-hidden={revealed ? undefined : true}
    >
      {/* Brand slot — transitional. The name is not final; see the plan book §10. */}
      <span
        data-brand-slot
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[11.5px] font-medium text-ink"
        title={tr('brand.placeholder.hint')}
      >
        <Mascot size={16} />
        {tr('brand.transition')}
      </span>

      <ModeTabs mode={mode} language={localPrefs.language} onSelect={setMode} />

      {/*
        The gap that used to hold the mode selector and the progress rail. Brand on the
        left, window controls on the right, nothing between: a drag region that says
        nothing is what a title bar is for, and the middle of this one was the most
        contested real estate in the shell.
      */}
      <div className="min-w-0 flex-1" />

      {/* Engine connection — opens the existing trust panel. */}
      <div className="relative shrink-0" ref={panelRef}>
        <button
          type="button"
          aria-label={tr('connection.panel')}
          aria-expanded={panelOpen}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium hover:bg-hover ${TONE_TEXT[connection.tone]}`}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <StatusDot tone={connection.tone} pulse={status === 'live' || status === 'connecting'} />
          <span>{connection.label}</span>
        </button>
        {panelOpen ? (
          <ConnectionPanel
            statusLabel={connection.label}
            tr={tr}
            onOpenSettings={() => {
              setPanelOpen(false);
              setSettingsOpen(true);
            }}
            onClose={() => setPanelOpen(false)}
          />
        ) : null}
      </div>

      {desktop ? (
        <div className="ml-1 flex shrink-0 items-center">
          <button type="button" aria-label="Minimize" className="grid h-8 w-9 place-items-center text-ink-3 hover:bg-hover hover:text-ink" onClick={() => void windowMinimize()}>
            <Icon name="minimize" size={13} />
          </button>
          <button type="button" aria-label="Maximize" className="grid h-8 w-9 place-items-center text-ink-3 hover:bg-hover hover:text-ink" onClick={() => void windowToggleMaximize()}>
            <Icon name="maximize" size={11} />
          </button>
          <button type="button" aria-label="Close" className="grid h-8 w-9 place-items-center text-ink-3 hover:bg-bad hover:text-white" onClick={() => void windowClose()}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null}
    </header>
  );
}

function ConnectionPanel({
  statusLabel,
  tr,
  onOpenSettings,
  onClose,
}: {
  statusLabel: string;
  tr: (key: Parameters<typeof t>[1]) => string;
  onOpenSettings: () => void;
  onClose: () => void;
}): ReactNode {
  const trust = readEngineTrust();
  const desktop = isTauri();
  const [note, setNote] = useState('');

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setNote(tr('connection.copied'));
    } catch {
      setNote(value);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={tr('connection.panel')}
      className="absolute right-0 top-full z-50 mt-1 w-[320px] rounded-lg border border-line bg-elevated p-3 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('connection.panel')}</span>
        <span className="text-[11px] text-ink-2">{statusLabel}</span>
      </div>

      {trust.expectsLiveEngine ? (
        <dl className="space-y-2 text-[12px]">
          <div>
            <dt className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{tr('connection.engineUrl')}</dt>
            <dd className="mt-0.5 flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-ink">{trust.engineUrl}</code>
              <button
                type="button"
                className="shrink-0 text-[11px] text-ink-3 hover:text-accent"
                onClick={() => void copy(trust.engineUrl ?? '')}
              >
                {tr('connection.copy')}
              </button>
            </dd>
          </div>
          <div>
            <dt className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{tr('connection.session')}</dt>
            <dd className="mt-0.5 font-mono text-[11px] text-ink">{trust.sessionId || '—'}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-[12px] text-ink-2">
          {tr('connection.fixture')}
          {trust.scene ? (
            <span className="mt-1 block font-mono text-[11px] text-ink-3">
              {tr('connection.scene')}: {trust.scene}
            </span>
          ) : null}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {desktop ? (
          <>
            <button
              type="button"
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
              onClick={() => {
                void openEngineLog().then((result) => {
                  setNote(result.error ?? result.path ?? '');
                });
              }}
            >
              {tr('connection.openLog')}
            </button>
            <button
              type="button"
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
              onClick={() => {
                void relaunchDesktop().then((error) => {
                  if (error) setNote(error);
                  else onClose();
                });
              }}
            >
              {tr('connection.restart')}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
          onClick={onOpenSettings}
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="settings" size={11} />
            {tr('settings.model')}
          </span>
        </button>
      </div>
      {note ? <p className="mt-2 break-all font-mono text-[10.5px] text-ink-3">{note}</p> : null}
    </div>
  );
}
