/**
 * Session-column resize handle. Visual line is 1px; the hit target is 6px.
 *
 * There is exactly one resizable column now. The right data rail is gone, so this
 * component no longer takes a `side`: a knob with a single legal value invites the
 * next reader to wonder which seam a `side="right"` handle would even sit on.
 * @module
 */

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { RAIL_LEFT_DEFAULT, clampRail } from '../state/local-prefs.js';
import { useUiStore } from '../state/UiProvider.js';

export function RailDivider(): ReactNode {
  const width = useUiStore((s) => s.localPrefs.leftWidth);
  const collapsed = useUiStore((s) => s.localPrefs.leftCollapsed);
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
      setLocalPrefs({ leftWidth: clampRail(startW + (ev.clientX - startX)) });
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

  // The icon rail sits outside this column, so the handle rides the column's *far* edge —
  // the boundary the drag actually moves. Without the offset it would sit on the icon
  // rail's right border and resize the wrong seam.
  // `--rail-icon-w` carries a fallback: an undefined custom property makes the whole
  // `calc()` invalid, which would drop the declaration and strand the handle.
  const style = {
    left: 'calc(var(--rail-icon-w, 48px) + var(--rail-left-w))',
    transform: 'translateX(-50%)',
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sessions"
      title="Drag to resize. Double-click to restore the default width."
      className="absolute top-0 z-20 h-full w-1.5 cursor-col-resize"
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setLocalPrefs({ leftWidth: RAIL_LEFT_DEFAULT })}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
    </div>
  );
}
