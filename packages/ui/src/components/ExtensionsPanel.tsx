/**
 * Extensions sidebar — the activity-bar view next to chats.
 *
 * The engine already scans `~/.camelia/plugins` for `camelia.plugin.json` when the
 * process starts (`paths.plugins`). There is no command that lists or installs those
 * folders, so this panel does not pretend a toggle enables anything. The install note
 * is the stub: drop a directory on disk and start the desktop again.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { MODE_HEADER_H } from '../modes/ModeHeader.js';
import { useUiStore } from '../state/UiProvider.js';
import { LeftSidebarToggle } from './PanelIcons.js';

export function ExtensionsPanel(): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const collapsed = useUiStore((s) => s.localPrefs.leftCollapsed);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [installOpen, setInstallOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-extensions-panel>
      <div
        data-extensions-header
        className="flex shrink-0 items-center px-3"
        style={{ height: MODE_HEADER_H }}
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-2">{tr('extensions.title')}</span>
        {collapsed ? null : <LeftSidebarToggle />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div
          data-extensions-empty
          className="rounded-lg border border-dashed border-line px-3 py-6 text-center"
        >
          <p className="text-[12.5px] font-medium text-ink">{tr('extensions.empty')}</p>
          <p className="mt-1.5 text-[11.5px] leading-5 text-ink-3">{tr('extensions.empty.hint')}</p>
        </div>
        <button
          type="button"
          data-extensions-install
          className="mt-3 text-[12px] text-accent hover:underline"
          aria-expanded={installOpen}
          onClick={() => setInstallOpen((open) => !open)}
        >
          {tr('extensions.installStub')}
        </button>
        {installOpen ? (
          <p className="mt-2 text-[11.5px] leading-5 text-ink-2" data-extensions-install-body>
            {tr('extensions.installBody')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
