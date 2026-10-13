/**
 * Edge and corner resize targets. Present only inside the Tauri webview.
 *
 * `z-40` rather than the old `z-30`: the south edge sits at the very bottom of the
 * window, which is exactly where the status bar now lives, and a 22px strip at `z-30`
 * would swallow it — the window would stop being resizable from the bottom edge with
 * nothing on screen to suggest why. Above the bar, below the drawer.
 * @module
 */

import type { ReactNode } from 'react';

import { isTauri, windowStartResize } from '../window/shell.js';

const EDGES: Array<{ direction: string; className: string }> = [
  { direction: 'North', className: 'top-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { direction: 'South', className: 'bottom-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { direction: 'West', className: 'left-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { direction: 'East', className: 'right-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { direction: 'NorthWest', className: 'left-0 top-0 h-3 w-3 cursor-nwse-resize' },
  { direction: 'NorthEast', className: 'right-0 top-0 h-3 w-3 cursor-nesw-resize' },
  { direction: 'SouthWest', className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
  { direction: 'SouthEast', className: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize' },
];

export function WindowEdges(): ReactNode {
  if (!isTauri()) return null;
  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge.direction}
          className={`absolute z-40 ${edge.className}`}
          onMouseDown={(event) => {
            event.preventDefault();
            void windowStartResize(edge.direction);
          }}
        />
      ))}
    </>
  );
}
