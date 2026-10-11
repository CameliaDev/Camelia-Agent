/**
 * Column resize handle. Visual line is 1px; the hit target is 6px.
 * @module
 */

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { clampRail } from '../state/local-prefs.js';
import { useUiStore } from '../state/UiProvider.js';

export function RailDivider({ side }: { side: 'left' | 'right' }): ReactNode {
  const width = useUiStore((s) => (side === 'left' ? s.localPrefs.leftWidth : s.localPrefs.rightWidth));
  const collapsed = useUiStore((s) => (side === 'left' ? s.localPrefs.leftCollapsed : s.localPrefs.rightCollapsed));
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);

  if (collapsed) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.detail > 1) return;
    event.preventDefault();
    const startX = event.clientX;
    const startW = width;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.documentElement.dataset.resizing = 'true';

    const move = (ev: globalThis.PointerEvent): void => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      const next = clampRail(side, startW + delta);
      setLocalPrefs(side === 'left' ? { leftWidth: next } : { rightWidth: next });
    };
    const up = (): void => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      delete document.documentElement.dataset.resizing;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const style =
    side === 'left'
      ? { left: 'var(--rail-left-w)', transform: 'translateX(-50%)' }
      : { right: 'var(--rail-right-w)', transform: 'translateX(50%)' };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize sessions' : 'Resize run rail'}
      title="Drag to resize. Double-click to restore the default width."
      className="absolute top-0 z-20 h-full w-1.5 cursor-col-resize"
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setLocalPrefs(side === 'left' ? { leftWidth: 260 } : { rightWidth: 360 })}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
    </div>
  );
}
