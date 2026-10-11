/**
 * Top bar — brand, phase, connection. Hidden until the pointer enters the top
 * hot zone, or until Ctrl+` . Session title and provider live on the right rail.
 * Connection chrome opens a trust panel (engine URL / session / log / restart).
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { CONNECTION_META, PHASE_META, TONE_TEXT } from '../lib/status.js';
import { useUiState } from '../state/UiProvider.js';
import { isTauri, windowClose, windowMinimize, windowStartDragging, windowToggleMaximize } from '../window/shell.js';
import { openEngineLog, readEngineTrust } from '../window/engine.js';
import { relaunchDesktop } from '../window/model-settings.js';
import { t } from '../i18n/strings.js';
import { Icon, StatusDot } from './primitives.js';

export function TopBar({ revealed }: { revealed: boolean }): ReactNode {
  const { snapshot, status, localPrefs, setSettingsOpen } = useUiState();
  const task = snapshot.task;
  const phase = task ? PHASE_META[task.phase] : undefined;
  const connection = CONNECTION_META[status];
  const desktop = isTauri();
  const tr = (k: Parameters<typeof t>[1]) => t(localPrefs.language, k);
  const provider = snapshot.provider.activeProvider;
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
    // Let buttons handle their own clicks; drag everything else on the bar.
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.button !== 0) return;
    void windowStartDragging();
  };

  return (
    <header
      className={`camelia-topbar absolute inset-x-0 top-0 z-40 flex h-9 items-center gap-3 border-b border-line bg-elevated px-3 ${
        revealed ? 'translate-y-0' : 'pointer-events-none -translate-y-full'
      }`}
      data-tauri-drag-region
      onMouseDown={onMouseDown}
      aria-hidden={revealed ? undefined : true}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-accent"
          title="Warm intelligence, sharp code."
        >
          <Icon name="camellia" size={15} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-ink">Camelia</span>
      </div>

      <span className="h-5 w-px bg-line" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {phase ? (
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${TONE_TEXT[phase.tone]}`}>
            <StatusDot tone={phase.tone} pulse={task?.phase === 'executing' || task?.phase === 'planning'} />
            {phase.label}
          </span>
        ) : snapshot.session ? (
          <span className="min-w-0 truncate text-[12px] text-ink-2">{tr('status.idle')}</span>
        ) : (
          <span className="text-[12px] text-ink-3">{tr('status.noSession')}</span>
        )}
        {provider ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-ink-3" title={snapshot.provider.activeModel}>
            <Icon name="layers" size={11} />
            <span className="truncate font-mono">{provider}</span>
          </span>
        ) : status === 'connecting' ? (
          <span className="text-[11px] text-ink-3">{tr('provider.connecting')}</span>
        ) : null}
      </div>

      <div className="relative" ref={panelRef}>
        <button
          type="button"
          aria-label={tr('connection.panel')}
          aria-expanded={panelOpen}
          className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium hover:bg-hover ${TONE_TEXT[connection.tone]}`}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <StatusDot tone={connection.tone} pulse={status === 'live' || status === 'connecting'} />
          <span>{connection.label}</span>
          <Icon name="chevron" size={10} />
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
        <div className="ml-2 flex items-center">
          <button type="button" aria-label="Minimize" className="grid h-8 w-10 place-items-center text-ink-2 hover:bg-hover" onClick={() => void windowMinimize()}>
            <Icon name="minimize" size={14} />
          </button>
          <button type="button" aria-label="Maximize" className="grid h-8 w-10 place-items-center text-ink-2 hover:bg-hover" onClick={() => void windowToggleMaximize()}>
            <Icon name="maximize" size={12} />
          </button>
          <button type="button" aria-label="Close" className="grid h-8 w-10 place-items-center text-ink-2 hover:bg-bad hover:text-white" onClick={() => void windowClose()}>
            <Icon name="x" size={14} />
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
