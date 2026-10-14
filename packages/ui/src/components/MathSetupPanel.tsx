/**
 * Math new-session setup, drawn in the right column.
 *
 * Choosing a contest and whether to use the built-in templates happens before
 * the session exists, so a mis-click does not leave an empty math row behind.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { makeCommand } from '../state/store.js';
import { setMathProfile, setMathSetupOpen, type MathContest } from '../state/shell-extras.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';

const CONTESTS: readonly MathContest[] = ['cumcm', 'mcm', 'other'];

export function MathSetupPanel(): ReactNode {
  const { query, setActiveSession, dispatch } = useUiState();
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (key: Parameters<typeof t>[1]) => t(lang, key);
  const [contest, setContest] = useState<MathContest>('cumcm');
  const [useTemplates, setUseTemplates] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = (): void => {
    if (busy) return;
    setBusy(true);
    query<{ sessionId: string }>(makeCommand('new_session', { kind: 'math' }))
      .then((res) => {
        if (!res?.sessionId) return;
        setMathProfile(res.sessionId, { contest, useTemplates });
        setActiveSession(res.sessionId);
        dispatch(makeCommand('select_session', { sessionId: res.sessionId }));
      })
      .catch(() => {
        setBusy(false);
      });
  };

  return (
    <aside
      data-right-rail
      data-math-setup
      aria-label={tr('math.setup.title')}
      className="relative flex min-h-0 min-w-0 flex-col border-l border-line bg-base"
    >
      <div className="flex shrink-0 items-center border-b border-line/70 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{tr('math.setup.title')}</span>
        <button
          type="button"
          data-math-setup-close
          aria-label={tr('settings.close')}
          className="rounded px-1.5 py-0.5 text-[12px] text-ink-3 hover:bg-hover hover:text-ink"
          onClick={() => setMathSetupOpen(false)}
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <fieldset className="space-y-1.5">
          <legend className="text-[11.5px] text-ink-3">{tr('math.setup.contest')}</legend>
          {CONTESTS.map((id) => (
            <label key={id} className="flex items-center gap-2 text-[13px] text-ink">
              <input
                type="radio"
                name="math-contest"
                data-math-contest={id}
                checked={contest === id}
                onChange={() => setContest(id)}
              />
              {tr(`math.setup.${id}` as Parameters<typeof t>[1])}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input
            type="checkbox"
            data-math-templates
            checked={useTemplates}
            onChange={(event) => setUseTemplates(event.target.checked)}
          />
          {tr('math.setup.templates')}
        </label>
        <button
          type="button"
          data-math-setup-create
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-2 disabled:opacity-60"
          onClick={create}
        >
          {tr('math.setup.create')}
        </button>
      </div>
    </aside>
  );
}
