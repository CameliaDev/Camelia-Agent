/**
 * Skills sidebar — local SKILL.md folders plus the Camelia catalog.
 *
 * "Open folder" adds a scan root. "Install…" copies a picked folder into
 * `~/.camelia/skills`. Catalog rows install the same way after the engine
 * clones the registry entry (`install_catalog_skill` → `install_skill`).
 * @module
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { matchesCatalogQuery, type CatalogEntryView } from '../catalog/match.js';
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

interface CatalogPayload {
  skills?: CatalogEntryView[];
}

export function SkillsPanel(): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const workspace = useUiStore((s) => s.snapshot.session?.workspace);
  const queryCmd = useUiStore((s) => s.query);
  const tr = (key: Parameters<typeof t>[1]) => t(lang, key);
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntryView[]>([]);
  const [extraRoot, setExtraRoot] = useState('');
  const [note, setNote] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState('');

  const load = useCallback(async (root = extraRoot): Promise<void> => {
    setLoading(true);
    const [listedResult, catalogResult] = await Promise.allSettled([
      queryCmd<SkillRow[]>(
        makeCommand('list_skills', {
          ...(workspace ? { workspace } : {}),
          ...(root.trim() ? { extraRoot: root.trim() } : {}),
        }),
      ),
      queryCmd<CatalogPayload>(makeCommand('fetch_extension_catalog', {})),
    ]);
    if (listedResult.status === 'fulfilled') {
      setRows(Array.isArray(listedResult.value) ? listedResult.value : []);
      setNote('');
    } else {
      const reason = listedResult.reason;
      setNote(reason instanceof Error ? reason.message : String(reason));
    }
    if (catalogResult.status === 'fulfilled') {
      const skills = catalogResult.value?.skills;
      setCatalog(Array.isArray(skills) ? skills : []);
      setCatalogError('');
    } else {
      setCatalog([]);
      const reason = catalogResult.reason;
      setCatalogError(reason instanceof Error ? reason.message : t(lang, 'skills.catalogError'));
    }
    setLoading(false);
  }, [extraRoot, lang, queryCmd, workspace]);

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
        const installed = await queryCmd<SkillRow[] | { ok?: boolean; error?: string }>(
          makeCommand('install_skill', { path: picked.path }),
        );
        if (installed && !Array.isArray(installed) && installed.ok === false) {
          setNote(installed.error ?? tr('skills.failed'));
          return;
        }
        await load();
        setNote(tr('skills.installed'));
      } catch (error) {
        setNote(error instanceof Error ? error.message : tr('skills.failed'));
      }
    });
  };

  const installFromCatalog = (id: string): void => {
    setInstalling(id);
    void queryCmd<SkillRow[] | { ok?: boolean; error?: string }>(makeCommand('install_catalog_skill', { id }))
      .then(async (installed) => {
        if (installed && !Array.isArray(installed) && installed.ok === false) {
          setNote(installed.error ?? tr('skills.failed'));
          return;
        }
        await load();
        setNote(tr('skills.installed'));
      })
      .catch((error: unknown) => {
        setNote(error instanceof Error ? error.message : tr('skills.failed'));
      })
      .finally(() => setInstalling(''));
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

  const visibleRows = rows.filter((skill) => matchesCatalogQuery(skill, query));
  const visibleCatalog = catalog.filter((entry) => matchesCatalogQuery(entry, query));
  const needle = query.trim();
  const installedNames = new Set(rows.flatMap((skill) => [skill.name.toLowerCase(), skill.id.toLowerCase()]));

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
      <div className="shrink-0 px-2.5 pb-2">
        <input
          data-skills-search
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr('skills.search')}
          aria-label={tr('skills.search')}
          className="w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
        />
      </div>
      {extraRoot ? (
        <p className="truncate px-2 pb-1 font-mono text-[10.5px] text-ink-3" data-skills-root title={extraRoot}>
          {tr('skills.root')}: {extraRoot}
        </p>
      ) : null}
      {note ? <p className="px-2 pb-1 text-[11.5px] text-ink-3">{note}</p> : null}
      {catalogError ? (
        <p className="px-2 pb-1 text-[11.5px] text-ink-3" data-skills-catalog-error>
          {catalogError}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {loading ? <p className="px-2 text-[11.5px] text-ink-3">{tr('skills.loading')}</p> : null}
        {!loading && !needle && rows.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11.5px] leading-5 text-ink-3">
            {tr('skills.empty')}
            <br />
            {tr('skills.empty.hint')}
          </div>
        ) : null}
        {visibleRows.map((skill) => (
          <div key={skill.id} data-skill={skill.id} className="rounded-md px-2 py-1.5 hover:bg-hover/60">
            <p className="truncate text-[12.5px] text-ink">{skill.name}</p>
            {skill.description ? (
              <p className="truncate text-[11px] text-ink-3">{skill.description}</p>
            ) : null}
            <p className="truncate font-mono text-[10px] text-ink-3">{skill.source}</p>
          </div>
        ))}
        <section className="pt-2" data-skills-catalog>
          <p className="px-2 pb-1 text-[11.5px] font-medium text-ink-2">
            {tr('skills.catalog')}
            <span className="ml-1.5 font-mono text-[10.5px] text-ink-3" data-skills-catalog-count>
              {visibleCatalog.length}
            </span>
          </p>
          {visibleCatalog.map((entry) => {
            const onDisk =
              installedNames.has(entry.id.toLowerCase()) || installedNames.has(entry.name.toLowerCase());
            return (
              <div key={entry.id} data-catalog-skill={entry.id} className="rounded-md px-2 py-1.5 hover:bg-hover/60">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{entry.name}</p>
                  {onDisk ? (
                    <span data-catalog-skill-installed={entry.id} className="shrink-0 text-[11px] text-ink-3">
                      {tr('skills.installedBadge')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-catalog-skill-install={entry.id}
                      disabled={installing === entry.id}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
                      onClick={() => installFromCatalog(entry.id)}
                    >
                      {installing === entry.id ? tr('skills.installing') : tr('skills.catalogInstall')}
                    </button>
                  )}
                </div>
                {entry.description ? <p className="text-[11px] leading-4 text-ink-3">{entry.description}</p> : null}
              </div>
            );
          })}
        </section>
        {needle && visibleRows.length === 0 && visibleCatalog.length === 0 ? (
          <p className="px-2 pt-2 text-[12px] text-ink-3" data-skills-no-match>
            {tr('skills.noMatch')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
