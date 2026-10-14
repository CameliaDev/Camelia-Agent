/**
 * Extensions sidebar — installed plugins, searched locally.
 *
 * The engine reads `~/.camelia/plugins` when the process starts. There is no
 * marketplace in this build, so search filters that installed list and the
 * install note stays behind the header menu.
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { MODE_HEADER_H } from '../modes/ModeHeader.js';
import { useUiStore } from '../state/UiProvider.js';
import { Icon } from './primitives.js';

export function ExtensionsPanel(): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen && !filterOpen) return;
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (moreOpen && moreRef.current && !moreRef.current.contains(target)) setMoreOpen(false);
      if (filterOpen && filterRef.current && !filterRef.current.contains(target)) setFilterOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen, filterOpen]);

  const installed: readonly { id: string; name: string }[] = [];
  const needle = query.trim().toLowerCase();
  const visible = needle ? installed.filter((item) => item.name.toLowerCase().includes(needle)) : installed;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-extensions-panel>
      <div
        data-extensions-header
        className="flex shrink-0 items-center gap-1 px-2"
        style={{ height: MODE_HEADER_H }}
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{tr('extensions.panelTitle')}</span>
        <button
          type="button"
          data-extensions-refresh
          aria-label={tr('extensions.refresh')}
          title={tr('extensions.refresh')}
          className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
          onClick={() => {
            setQuery('');
            setFilterOpen(false);
            setNote(true);
          }}
        >
          <Icon name="refresh" size={13} />
        </button>
        <div ref={moreRef} className="relative">
          <button
            type="button"
            data-extensions-more
            aria-label={tr('extensions.more')}
            aria-expanded={moreOpen}
            title={tr('extensions.more')}
            className="grid h-6 w-6 place-items-center rounded text-[14px] leading-none text-ink-3 hover:bg-hover hover:text-ink"
            onClick={() => setMoreOpen((open) => !open)}
          >
            …
          </button>
          {moreOpen ? (
            <div
              data-extensions-more-menu
              className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border border-line bg-elevated p-1 shadow-lg"
            >
              <button
                type="button"
                data-extensions-install
                className="w-full rounded px-2 py-1.5 text-left text-[12px] text-ink-2 hover:bg-hover hover:text-ink"
                onClick={() => {
                  setInstallOpen(true);
                  setMoreOpen(false);
                }}
              >
                {tr('extensions.installStub')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 space-y-1.5 px-2.5 pb-2">
        <input
          data-extensions-search
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr('extensions.search')}
          aria-label={tr('extensions.search')}
          className="w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
        />
        <div ref={filterRef} className="relative">
          <button
            type="button"
            data-extensions-filter
            aria-expanded={filterOpen}
            aria-label={tr('extensions.filter')}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <Icon name="filter" size={12} />
            {tr('extensions.filter')}
          </button>
          {filterOpen ? (
            <div
              data-extensions-filter-menu
              role="menu"
              className="absolute left-0 top-full z-20 mt-1 w-36 rounded-md border border-line bg-elevated p-1 shadow-lg"
            >
              <div
                role="menuitemcheckbox"
                aria-checked="true"
                data-extensions-filter-installed
                className="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-ink"
              >
                <Icon name="check" size={12} />
                {tr('extensions.filterInstalled')}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <p className="flex items-baseline gap-1.5 text-[11.5px] font-medium text-ink-2">
          {tr('extensions.installed')}
          <span className="font-mono text-[10.5px] text-ink-3" data-extensions-count>
            {installed.length}
          </span>
        </p>
        {note ? (
          <p className="mt-2 text-[11.5px] leading-5 text-ink-3" data-extensions-refresh-note>
            {tr('extensions.loadedAtStart')}
          </p>
        ) : null}
        {needle && visible.length === 0 ? (
          <p className="mt-3 text-[12px] text-ink-3" data-extensions-no-match>
            {tr('extensions.noMatch')}
          </p>
        ) : null}
        {!needle && visible.length === 0 ? (
          <div
            data-extensions-empty
            className="mt-3 rounded-lg border border-dashed border-line px-3 py-6 text-center"
          >
            <p className="text-[12.5px] font-medium text-ink">{tr('extensions.empty')}</p>
            <p className="mt-1.5 text-[11.5px] leading-5 text-ink-3">{tr('extensions.empty.hint')}</p>
          </div>
        ) : null}
        {installOpen ? (
          <p className="mt-3 text-[11.5px] leading-5 text-ink-2" data-extensions-install-body>
            {tr('extensions.installBody')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
