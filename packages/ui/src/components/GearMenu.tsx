/**
 * Small menu on the settings gear.
 *
 * The gear used to open the full settings page immediately. Themes and the
 * shortcut list are the common jobs, so they stay in this popover. The full
 * page is one item further down.
 * @module
 */

import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { THEME_PRESETS, type ThemeId } from '../theme/presets.js';
import { Icon } from './primitives.js';

export function GearMenu({ onClose }: { onClose: () => void }): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const themeId = useUiStore((s) => s.localPrefs.themeId);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const tr = (key: Parameters<typeof t>[1]) => t(lang, key);
  const [page, setPage] = useState<'root' | 'themes' | 'shortcuts'>('root');

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (page !== 'root') {
        setPage('root');
        return;
      }
      onClose();
    };
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest?.('[data-gear-menu]')) return;
      if (target.closest?.('[data-rail-settings]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [onClose, page]);

  return (
    <div
      data-gear-menu
      role="menu"
      aria-label={tr('settings.title')}
      className="absolute bottom-0 left-full z-[60] ml-2 w-[232px] rounded-lg border border-line bg-elevated p-1 shadow-lg"
    >
      {page === 'root' ? (
        <>
          <MenuRow label={tr('gear.themes')} marker="data-gear-themes" onClick={() => setPage('themes')} />
          <MenuRow label={tr('gear.shortcuts')} marker="data-gear-shortcuts" onClick={() => setPage('shortcuts')} />
          <MenuRow
            label={tr('gear.settings')}
            marker="data-gear-settings"
            onClick={() => {
              setSettingsOpen(true);
              onClose();
            }}
          />
        </>
      ) : null}
      {page === 'themes' ? (
        <div>
          <Back label={tr('gear.themes')} onBack={() => setPage('root')} />
          <ul className="mt-0.5" aria-label={tr('gear.themes')}>
            {THEME_PRESETS.map((preset) => {
              const selected = preset.id === themeId;
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-gear-theme={preset.id}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
                      selected ? 'bg-accent/12 font-medium text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink'
                    }`}
                    onClick={() => setLocalPrefs({ themeId: preset.id as ThemeId })}
                  >
                    <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                    {selected ? <Icon name="check" size={12} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {page === 'shortcuts' ? (
        <div data-gear-shortcut-list>
          <Back label={tr('gear.shortcuts')} onBack={() => setPage('root')} />
          <ul className="mt-0.5 space-y-0.5">
            <Shortcut keys="Ctrl+B" label={tr('shortcut.left')} />
            <Shortcut keys="Ctrl+Alt+B" label={tr('shortcut.right')} />
            <Shortcut keys="Ctrl+`" label={tr('shortcut.topbar')} />
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({
  label,
  marker,
  onClick,
}: {
  label: string;
  marker: string;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      {...{ [marker]: '' }}
      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Back({ label, onBack }: { label: string; onBack: () => void }): ReactNode {
  return (
    <button
      type="button"
      data-gear-back
      className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink"
      onClick={onBack}
    >
      <Icon name="chevron" size={11} className="rotate-180" />
      {label}
    </button>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }): ReactNode {
  return (
    <li className="flex items-center gap-2 px-2 py-1 text-[12px]">
      <span className="min-w-0 flex-1 text-ink-2">{label}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{keys}</span>
    </li>
  );
}
