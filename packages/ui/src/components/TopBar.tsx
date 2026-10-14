/**
 * Top bar — logo and product name, the session title, window controls.
 *
 * The right drawer toggle stays here while the drawer is open, with 更多
 * beside it. It does not move into the drawer header. The left column's
 * collapse control is the activity bar; this bar only offers expand once
 * that column is already closed. Connection status is a status-bar readout
 * that opens Settings → Engine.
 * @module
 */

import type { MouseEvent, ReactNode } from 'react';

import { projectionMatchesMode } from '../mode/session-kind.js';
import { useMode } from '../mode/useMode.js';
import { PRODUCT_NAME } from '../transport/boot.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { isTauri, windowClose, windowMinimize, windowStartDragging, windowToggleMaximize } from '../window/shell.js';
import { LeftSidebarToggle, PanelDrawerToggle } from './PanelIcons.js';
import { PanelSectionMenu } from './PanelSectionMenu.js';
import { Icon, Mascot } from './primitives.js';

export function TopBar({ revealed }: { revealed: boolean }): ReactNode {
  const { snapshot, localPrefs } = useUiState();
  const { mode } = useMode();
  const panelId = useUiStore((s) => s.panelId);
  const desktop = isTauri();
  const title = projectionMatchesMode(snapshot, mode) ? snapshot.session?.title : undefined;
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
          <span data-topbar-title className="max-w-[min(28rem,40vw)] truncate text-[15px] font-semibold text-ink" title={title}>
            {title}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 pr-1">
        {leftOpen ? null : <LeftSidebarToggle />}
        {panelId ? <PanelSectionMenu /> : null}
        <PanelDrawerToggle />
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
