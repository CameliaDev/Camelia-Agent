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
 * ## Visibility policy
 *
 * The bar is an overlay that can slide away (`localPrefs.topBar`). But it now carries the
 * progress rail, and "work is in flight" is exactly when the user needs to see progress.
 * So: **while a task is running the bar is forced visible**, regardless of `auto`. When
 * the user has explicitly chosen `hidden`, that choice still wins — and at that point the
 * activity bar carries the same rail, so progress is never lost. See `App.tsx`.
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { CONNECTION_META, TONE_TEXT } from '../lib/status.js';
import { useUiState } from '../state/UiProvider.js';
import { isTauri, windowClose, windowMinimize, windowStartDragging, windowToggleMaximize } from '../window/shell.js';
import { openEngineLog, readEngineTrust } from '../window/engine.js';
import { relaunchDesktop } from '../window/model-settings.js';
import { t } from '../i18n/strings.js';
import { deriveProgress } from '../progress/deriveProgress.js';
import { ProgressMicrocopy, TaskProgressBar } from '../progress/TaskProgressBar.js';
import { useMode } from '../mode/useMode.js';
import { ModeTabs } from '../mode/ModeTabs.js';
import { Icon, StatusDot } from './primitives.js';

export function TopBar({ revealed }: { revealed: boolean }): ReactNode {
  const { snapshot, status, localPrefs, setSettingsOpen, mathDemo } = useUiState();
  const connection = CONNECTION_META[status];
  const desktop = isTauri();
  const tr = (k: Parameters<typeof t>[1]) => t(localPrefs.language, k);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { mode, setMode } = useMode();

  const progress = deriveProgress({
    task: snapshot.task,
    mode,
    language: localPrefs.language,
    ...(mathDemo ? { mathDemo } : {}),
  });
  const taskRunning = progress.progress.kind === 'task'
    ? progress.progress.status === 'running' || progress.progress.status === 'paused'
    : progress.progress.kind === 'math'
      ? progress.progress.status === 'running'
      : snapshot.task !== undefined && snapshot.task.status !== 'done' && snapshot.task.status !== 'failed' && snapshot.task.status !== 'cancelled';

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
        <Icon name="camellia" size={13} className="text-accent" />
        {tr('brand.transition')}
      </span>

      <span className="h-4 w-px shrink-0 bg-line" />

      {/* Mode selector — the only way the mode changes. */}
      <ModeTabs mode={mode} language={localPrefs.language} onSelect={setMode} taskRunning={taskRunning} />

      <span className="h-4 w-px shrink-0 bg-line" />

      {/* Progress: rail + microcopy. The copy drops first when narrow; the rail stays.
          Not mounted while the bar is off-screen (`topBar: 'hidden'`) — the activity bar
          carries the same rail there, and mounting both would leave two progress nodes in
          the tree, only one of which anyone can see. */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {revealed ? (
          <>
            <TaskProgressBar result={progress} />
            <span className="hidden min-w-0 shrink-0 md:block">
              <ProgressMicrocopy result={progress} language={localPrefs.language} />
            </span>
          </>
        ) : null}
      </div>

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
