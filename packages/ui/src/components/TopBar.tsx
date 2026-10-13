/**
 * Top bar — logo and product name, the session title, window controls.
 *
 * Sidebar toggles are not parked here while their panel is open. Each one
 * lives in that panel's header, and only returns to this bar when the panel
 * is closed so it can be opened again. Connection status is a status-bar
 * readout that opens Settings → Engine.
 * @module
 */

import type { MouseEvent, ReactNode } from 'react';

import { PRODUCT_NAME } from '../transport/boot.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { isTauri, windowClose, windowMinimize, windowStartDragging, windowToggleMaximize } from '../window/shell.js';
import { LeftSidebarToggle, PanelDrawerToggle } from './PanelIcons.js';
import { Icon, Mascot } from './primitives.js';

export function TopBar({ revealed }: { revealed: boolean }): ReactNode {
  const { snapshot, localPrefs } = useUiState();
  const panelId = useUiStore((s) => s.panelId);
  const desktop = isTauri();
  const title = snapshot.session?.title;
  const leftOpen = !localPrefs.leftCollapsed;

  const onMouseDown = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.button !== 0) return;
    void windowStartDragging();
  };

  return (
    <header
      className={`camelia-topbar absolute inset-x-0 top-0 z-40 flex h-9 items-center border-b border-line bg-base text-[12px] ${
        revealed ? 'translate-y-0' : 'pointer-events-none -translate-y-full'
      }`}
      data-tauri-drag-region
      onMouseDown={onMouseDown}
      aria-hidden={revealed ? undefined : true}
    >
      <span data-brand-slot className="flex h-full shrink-0 items-center gap-1.5 pl-[11px] pr-3">
        <Mascot size={20} alt="" />
        <span className="text-[13px] font-medium tracking-tight text-ink">{PRODUCT_NAME}</span>
      </span>

      <div className="pointer-events-none absolute inset-y-0 left-36 right-28 flex items-center justify-center">
        {title ? (
          <span data-topbar-title className="max-w-[min(28rem,40vw)] truncate text-[12px] text-ink-3" title={title}>
            {title}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 pr-1">
        {leftOpen ? null : <LeftSidebarToggle />}
        {panelId ? null : <PanelDrawerToggle />}
        {desktop ? (
          <div className="ml-1 flex shrink-0 items-center">
            <button type="button" aria-label="Minimize" className="grid h-7 w-8 place-items-center text-ink-3 hover:bg-hover hover:text-ink" onClick={() => void windowMinimize()}>
              <Icon name="minimize" size={12} />
            </button>
            <button type="button" aria-label="Maximize" className="grid h-7 w-8 place-items-center text-ink-3 hover:bg-hover hover:text-ink" onClick={() => void windowToggleMaximize()}>
              <Icon name="maximize" size={11} />
            </button>
            <button type="button" aria-label="Close" className="grid h-7 w-8 place-items-center text-ink-3 hover:bg-bad hover:text-white" onClick={() => void windowClose()}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
