/**
 * Settings → Memory.
 *
 * Lists every memory, not the session-scoped task panel. Forgetting, marking
 * incorrect, and promoting go through the same commands, then the list reloads
 * into this section's own state so the task panel's scope stays put.
 * @module
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { ForgetLogView, MemoryView } from '@camelia/agent/view';

import { t } from '../i18n/strings.js';
import { makeCommand } from '../state/store.js';
import { useUiStore } from '../state/UiProvider.js';

export function MemorySettingsSection(): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const query = useUiStore((s) => s.query);
  const tr = (key: Parameters<typeof t>[1]) => t(lang, key);
  const [items, setItems] = useState<MemoryView[]>([]);
  const [log, setLog] = useState<ForgetLogView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await query<MemoryView[]>(makeCommand('list_memories', {}));
      const forgotten = await query<ForgetLogView[]>(makeCommand('list_forget_log', {}));
      setItems(next ?? []);
      setLog(forgotten ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function act(type: 'forget_memory' | 'mark_memory_incorrect' | 'promote_memory', memoryId: string): Promise<void> {
    if (type === 'promote_memory') await query(makeCommand('promote_memory', { memoryId }));
    else if (type === 'forget_memory') await query(makeCommand('forget_memory', { memoryId, reason: 'manual' }));
    else await query(makeCommand('mark_memory_incorrect', { memoryId, reason: 'user-correction' }));
    await reload();
  }

  return (
    <div data-settings-memory className="space-y-3">
      <p className="text-[12.5px] leading-5 text-ink-3">{tr('memory.settings.hint')}</p>
      {error ? <p className="text-[12.5px] text-bad">{error}</p> : null}
      {loading && items.length === 0 ? <p className="text-[12.5px] text-ink-3">…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="text-[12.5px] text-ink-3" data-settings-memory-empty>
          {tr('memory.settings.empty')}
        </p>
      ) : null}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} data-memory-row={item.id} className="rounded-md border border-line px-2.5 py-2">
            <p className="text-[11px] text-ink-3">
              {item.layer} · {item.kind}
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-ink">{item.content}</p>
            <div className="mt-1.5 flex justify-end gap-2">
              {item.layer === 'short' ? (
                <button
                  type="button"
                  data-memory-promote={item.id}
                  className="text-[11px] text-ink-3 hover:text-ok"
                  onClick={() => void act('promote_memory', item.id)}
                >
                  {tr('memory.settings.promote')}
                </button>
              ) : null}
              <button
                type="button"
                data-memory-incorrect={item.id}
                className="text-[11px] text-ink-3 hover:text-warn"
                onClick={() => void act('mark_memory_incorrect', item.id)}
              >
                {tr('memory.settings.incorrect')}
              </button>
              <button
                type="button"
                data-memory-forget={item.id}
                className="text-[11px] text-ink-3 hover:text-bad"
                onClick={() => void act('forget_memory', item.id)}
              >
                {tr('memory.settings.forget')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div data-settings-forget-log>
        <p className="text-[11.5px] text-ink-3">
          {tr('memory.settings.forgetLog')} · {log.length}
        </p>
        <ul className="mt-1 space-y-1">
          {log.slice(0, 6).map((entry) => (
            <li key={entry.id} className="truncate text-[11.5px] text-ink-2">
              {entry.contentSnippet}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
