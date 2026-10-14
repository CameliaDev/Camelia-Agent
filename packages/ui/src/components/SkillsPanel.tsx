/**
 * Skills sidebar — folders that contain SKILL.md.
 *
 * Install copies a folder into `~/.camelia/skills`. "Open folder" adds a scan
 * root for this window so a Cursor or Claude skills directory can be listed
 * without copying it first.
 * @module
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { MODE_HEADER_H } from '../modes/ModeHeader.js';
import { makeCommand } from '../state/store.js';
import { useUiStore } from '../state/UiProvider.js';
import { pickFolder } from '../window/pick-folder.js';

interface SkillRow {
  id: string;
  name: string;
  description: string;
  dir: string;
  source: string;
}

export function SkillsPanel(): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const workspace = useUiStore((s) => s.snapshot.session?.workspace);
  const query = useUiStore((s) => s.query);
  const tr = (key: Parameters<typeof t>[1]) => t(lang, key);
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [extraRoot, setExtraRoot] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async (root = extraRoot): Promise<void> => {
    try {
      const listed = await query<SkillRow[]>(
        makeCommand('list_skills', {
          ...(workspace ? { workspace } : {}),
          ...(root.trim() ? { extraRoot: root.trim() } : {}),
        }),
      );
      setRows(Array.isArray(listed) ? listed : []);
      setNote('');
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  }, [extraRoot, query, workspace]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = (): void => {
    void pickFolder().then(async (picked) => {
      if (!picked.ok) {
        if (picked.reason === 'failed') setNote(tr('workspace.browseFailed'));
        return;
      }
      try {
        const installed = await query<SkillRow[] | { ok?: boolean; error?: string }>(
          makeCommand('install_skill', { path: picked.path }),
        );
        if (installed && !Array.isArray(installed) && installed.ok === false) {
          setNote(installed.error ?? tr('skills.failed'));
          return;
        }
        setNote(tr('skills.installed'));
        await load();
      } catch (error) {
        setNote(error instanceof Error ? error.message : tr('skills.failed'));
      }
    });
  };

  const openRoot = (): void => {
    void pickFolder().then((picked) => {
      if (!picked.ok) {
        if (picked.reason === 'failed') setNote(tr('workspace.browseFailed'));
        return;
      }
      setExtraRoot(picked.path);
      void load(picked.path);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-skills-panel>
      <div
        data-skills-header
        className="flex shrink-0 items-center gap-1 px-2"
        style={{ height: MODE_HEADER_H }}
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{tr('skills.panelTitle')}</span>
        <button
          type="button"
          data-skills-open-folder
          className="rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
          onClick={openRoot}
        >
          {tr('skills.openFolder')}
        </button>
        <button
          type="button"
          data-skills-install
          className="rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
          onClick={install}
        >
          {tr('skills.install')}
        </button>
      </div>
      {extraRoot ? (
        <p className="truncate px-2 pb-1 font-mono text-[10.5px] text-ink-3" data-skills-root title={extraRoot}>
          {tr('skills.root')}: {extraRoot}
        </p>
      ) : null}
      {note ? <p className="px-2 pb-1 text-[11.5px] text-ink-3">{note}</p> : null}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {rows.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11.5px] leading-5 text-ink-3">
            {tr('skills.empty')}
            <br />
            {tr('skills.empty.hint')}
          </div>
        ) : (
          rows.map((skill) => (
            <div key={skill.id} data-skill={skill.id} className="rounded-md px-2 py-1.5 hover:bg-hover/60">
              <p className="truncate text-[12.5px] text-ink">{skill.name}</p>
              {skill.description ? (
                <p className="truncate text-[11px] text-ink-3">{skill.description}</p>
              ) : null}
              <p className="truncate font-mono text-[10px] text-ink-3">{skill.source}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
