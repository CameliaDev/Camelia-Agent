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
import { useUiState } from '../state/UiProvider.js';
import { Chip, Icon, KeyHint } from './primitives.js';

const SUGGESTIONS = [
  'Add a --json flag to the camelia CLI and make the acceptance report consume it.',
  'Find why the loop detector fires on healthy runs, then fix it.',
  'Refactor the tool engine so every schema is validated before dispatch.',
];

export function Composer(): ReactNode {
  const { snapshot, activeSessionId, dispatch, status } = useUiState();
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
          workspace: snapshot.session?.workspace ?? 'C:/Users/dev/projects/camelia-code',
        }),
      );
    }
    setValue('');
  };

  return (
    <footer className="shrink-0 border-t border-line bg-elevated/50 px-4 py-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-w-0 flex-1 items-end gap-2 rounded-lg border border-line bg-base px-2.5 py-2 focus-within:border-accent/50">
          <Icon name={running ? 'compass' : 'spark'} size={14} className={`mb-[3px] shrink-0 ${running ? 'text-info' : 'text-accent'}`} />
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
              running
                ? 'Steer the run — the goal is re-anchored, prior work is kept…'
                : 'Describe a task. Camelia plans, executes, verifies and shows its work…'
            }
            className="min-h-[22px] max-h-40 min-w-0 flex-1 resize-none bg-transparent text-[12.5px] leading-5 text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className={`mb-[1px] inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              running ? 'bg-info/80 text-base hover:bg-info' : 'bg-accent text-base hover:bg-accent-2'
            }`}
          >
            <Icon name={running ? 'compass' : 'send'} size={12} />
            {running ? 'Steer' : 'Run'}
          </button>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip tone={status === 'live' ? 'accent' : 'muted'}>
          {running ? 'steering an active run' : 'no active run'}
        </Chip>
        {!running
          ? SUGGESTIONS.slice(0, 2).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setValue(s)}
                className="max-w-[46%] truncate rounded-full border border-line px-2 py-[1px] text-[10.5px] text-ink-3 hover:border-accent/40 hover:text-accent"
              >
                {s}
              </button>
            ))
          : null}
        <span className="ml-auto hidden items-center gap-1.5 text-[10px] text-ink-3 sm:flex">
          <KeyHint>Enter</KeyHint> to send
          <KeyHint>Shift</KeyHint>+<KeyHint>Enter</KeyHint> for a new line
        </span>
      </div>
    </footer>
  );
}