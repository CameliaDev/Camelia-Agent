/**
 * Edge and corner resize targets. Present only inside the Tauri webview.
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
          className={`absolute z-30 ${edge.className}`}
          onMouseDown={(event) => {
            event.preventDefault();
            void windowStartResize(edge.direction);
          }}
        />
      ))}
    </>
  );
}
