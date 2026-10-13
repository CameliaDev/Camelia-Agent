/**
 * Default-collapsed detail block (F1) — one-line summary until expanded.
 * When `preferOpen` becomes true (current running step), expand automatically.
 * @module
 */

import { useEffect, useState, type ReactNode } from 'react';

export function CollapsibleBlock({
  summary,
  children,
  defaultOpen = false,
  preferOpen = false,
  summaryClassName,
  'data-collapsible': dataAttr,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** When true, force-expand (current running step). */
  preferOpen?: boolean;
  summaryClassName?: string;
  'data-collapsible'?: string;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen || preferOpen);
  useEffect(() => {
    if (preferOpen) setOpen(true);
  }, [preferOpen]);
  return (
    <div data-collapsible={dataAttr ?? 'block'} data-collapsed={open ? 'false' : 'true'} className="min-w-0">
      <button
        type="button"
        data-collapsible-toggle
        className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11.5px] hover:bg-hover ${
          summaryClassName ?? 'border-line/80 bg-base/50 text-ink-2'
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="shrink-0 text-ink-3">{open ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </button>
      {open ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}
