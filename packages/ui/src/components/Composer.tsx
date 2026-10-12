/**
 * Composer (bottom bar) — one input, two meanings.
 *
 * With no active task it submits a new task; while a task is running it steers the
 * existing goal. That mapping is explicit in the button label, because "what will happen
 * if I press enter" should never be ambiguous.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { makeCommand } from '../state/store.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { t } from '../i18n/strings.js';

export function Composer(): ReactNode {
  const { snapshot, activeSessionId, dispatch } = useUiState();
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [value, setValue] = useState('');
  const task = snapshot.task;
  const running = task !== undefined && task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled';

  const submit = (): void => {
    const intent = value.trim();
    if (!intent) return;
    if (running && task) {
      dispatch(makeCommand('intervene_goal', { taskId: task.id, instruction: intent }));
    } else {
      dispatch(
        makeCommand('submit_task', {
          sessionId: activeSessionId ?? 'ses_new',
          intent,
          workspace: snapshot.session?.workspace ?? '.',
        }),
      );
    }
    setValue('');
  };

  return (
    <footer className="shrink-0 border-t border-line bg-base px-4 py-2.5">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div data-composer className="flex min-w-0 flex-1 items-end gap-2 rounded-xl border border-line bg-base px-3 py-2 focus-within:border-accent/60">
          <textarea
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              running ? tr('composer.steerPlaceholder') : '描述一个任务，或继续当前会话…'
            }
            className="min-h-[22px] max-h-40 min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-5 text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            data-run
            disabled={!value.trim()}
            className={`mb-[1px] inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              running ? 'bg-info text-white hover:opacity-90' : 'bg-accent text-white hover:bg-accent-2'
            }`}
          >
            {running ? tr('steer') : tr('composer.run')}
          </button>
        </div>
      </form>
    </footer>
  );
}