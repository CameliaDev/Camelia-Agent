/**
 * Steering form — "change the goal mid-run".
 *
 * This used to live inside the chat transcript, which meant the button that opened it (in
 * the chat header) and the panel it opened could not both be shared: plan and math had no
 * way in. Both ends moved — the button into `RunControls`, the panel here, above the
 * composer — so steering is now the same two clicks in every mode.
 *
 * Drawn above the composer rather than inside the transcript for two reasons: it is an input,
 * not a message, and it must not scroll away while the user is typing in it.
 *
 * The copy was hard-coded English here while the rest of the shell is translated; it is
 * translated now, since this file is the one place it is rendered.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { makeCommand } from '../state/store.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';

export function SteeringForm(): ReactNode {
  const { snapshot, dispatch } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  const open = useUiStore((s) => s.steeringOpen);
  const setOpen = useUiStore((s) => s.setSteeringOpen);
  const [text, setText] = useState('');
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const task = snapshot.task;

  // A task can finish while the form is open — a cancel from the header, a run that ends.
  // Steering nothing would be a command the engine rejects, so the panel stands down.
  if (!open || !task) return null;

  return (
    <div className="shrink-0 px-4 pb-2">
      <form
        data-steering
        className="mx-auto w-full max-w-3xl rounded-lg border border-info/40 bg-info/10 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const instruction = text.trim();
          if (!instruction) return;
          dispatch(makeCommand('intervene_goal', { taskId: task.id, instruction }));
          setText('');
          setOpen(false);
        }}
      >
        <p className="text-[11.5px] font-medium text-info">{tr('steer.title')}</p>
        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tr('steer.placeholder')}
            aria-label={tr('steer.placeholder')}
            className="min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-info/60"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-md bg-info/80 px-2.5 py-1.5 text-[11.5px] font-medium text-base hover:bg-info disabled:opacity-40"
          >
            {tr('steer.send')}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-ink-2 hover:text-ink-3"
          >
            {tr('steer.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}