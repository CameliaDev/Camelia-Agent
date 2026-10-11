/**
 * Every icon at one size, for a human pass over stroke weight and alignment.
 * @module
 */

import type { ReactNode } from 'react';

import { ICON_NAMES, Icon } from './primitives.js';

export function IconSheet(): ReactNode {
  return (
    <div className="min-h-screen bg-base p-6 text-ink">
      <h1 className="mb-4 text-sm font-semibold">Icon sheet</h1>
      <div className="flex flex-wrap gap-3">
        {ICON_NAMES.map((name) => (
          <div key={name} className="flex w-[72px] flex-col items-center gap-1 rounded border border-line bg-elevated px-1 py-2">
            <Icon name={name} size={32} />
            <span className="text-center text-[9px] text-ink-3">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
