/**
 * Top bar — brand, phase, connection. Hidden until the pointer enters the top
 * hot zone, or until Ctrl+` . Session title and provider live on the right rail.
 * Connection chrome opens a trust panel (engine URL / session / log / restart).
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { CONNECTION_META, TONE_TEXT } from '../lib/status.js';
import { useUiState } from '../state/UiProvider.js';
import { isTauri, windowClose, windowMinimize, windowStartDragging, windowToggleMaximize } from '../window/shell.js';
import { openEngineLog, readEngineTrust } from '../window/engine.js';
import { relaunchDesktop } from '../window/model-settings.js';
import { t } from '../i18n/strings.js';
import { Icon, StatusDot } from './primitives.js';

export function TopBar({ revealed }: { revealed: boolean }): ReactNode {
  const { snapshot, status, localPrefs, setSettingsOpen } = useUiState();
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
    // Let buttons handle their own clicks; drag everything else on the bar.
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.button !== 0) return;
    void windowStartDragging();
  };

  return (
    <header
      className={`camelia-topbar absolute inset-x-0 top-0 z-40 flex h-9 items-center gap-2 border-b border-line bg-base px-3 text-[12px] ${
        revealed ? 'translate-y-0' : 'pointer-events-none -translate-y-full'
      }`}
      data-tauri-drag-region
      onMouseDown={onMouseDown}
      aria-hidden={revealed ? undefined : true}
    >
      {/* macOS-style window dots (placeholder) */}
      <div className="flex items-center gap-1.5 pl-1 pr-1">
        <span className="h-2.5 w-2.5 rounded-full bg-ink-3/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-3/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-3/30" />
      </div>

      {/* v2 新增 / 待定品牌位：橙色虚线胶囊 */}
      <span className="wf-dash-brand inline-flex items-center gap-1.5 rounded-full px-2.5 py-[2px] text-[11px] font-medium">
        <Icon name="camellia" size={11} />
        {tr('brand.placeholder')}
      </span>

      <span className="h-4 w-px bg-line" />

      {/* 当前会话标题 */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {snapshot.session ? (
          <span className="truncate text-[12px] text-ink-2">{snapshot.session.title ?? tr('status.idle')}</span>
        ) : (
          <span className="text-[12px] text-ink-3">{tr('status.noSession')}</span>
        )}
      </div>

      {/* 引擎连接状态（点击打开连接面板） */}
      <div className="relative" ref={panelRef}>
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

      {/* v2 标签：右栏按需滑出 */}
      <span className="wf-orange-tag">按需滑出</span>

      {desktop ? (
        <div className="ml-1 flex items-center">
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
