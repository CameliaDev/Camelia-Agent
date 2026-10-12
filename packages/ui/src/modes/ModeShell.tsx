/**
 * Mode shell — picks the work area for the active mode.
 *
 * It also renders the **cross-mode strip**: when a task is running and the user switches
 * to a mode that is not showing it, a non-modal line appears at the top of the new
 * workspace saying so, with a one-click way back. Silently hiding a running task is the
 * one failure mode this component exists to prevent — the user would reasonably conclude
 * the work had stopped.
 *
 * The strip is a strip, not a dialog: it never blocks the mode the user just chose.
 * @module
 */

import { useEffect, useRef, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { useMode } from '../mode/useMode.js';
import { ChatWorkspace } from './chat/ChatWorkspace.js';
import { PlanWorkspace } from './plan/PlanWorkspace.js';
import { MathWorkspace } from './math/MathWorkspace.js';

export function ModeShell(): ReactNode {
  const { mode, setMode } = useMode();
  const task = useUiStore((s) => s.snapshot.task);
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(language, k, params);

  const running = task !== undefined && task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled';
  const awaitingApproval = task?.status === 'awaiting-approval';

  /**
   * Tasks the user has manually navigated away from while approval was pending.
   *
   * Auto-routing is a courtesy, not a cage: it takes the user to the plan the *first* time
   * a task starts waiting on them, and then stops. Without this, a user who deliberately
   * goes back to chat to re-read the conversation would be yanked into plan mode again on
   * every render, and could not leave.
   */
  const dismissed = useRef<Set<string>>(new Set());

  // A new task resets the dismissal — a fresh approval is a fresh interruption worth making.
  const taskId = task?.id;
  useEffect(() => {
    if (taskId === undefined) dismissed.current.clear();
  }, [taskId]);

  useEffect(() => {
    if (!awaitingApproval || !taskId) return;
    if (mode === 'plan') return;
    if (dismissed.current.has(taskId)) return;
    setMode('plan');
  }, [awaitingApproval, taskId, mode, setMode]);

  // Leaving plan mode voluntarily while approval pends records the dismissal, so the
  // effect above does not immediately undo the user's click.
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === 'plan' && mode !== 'plan' && awaitingApproval && taskId) {
      dismissed.current.add(taskId);
    }
    lastMode.current = mode;
  }, [mode, awaitingApproval, taskId]);

  // The strip only makes sense when the running task's surface is not on screen. Chat and
  // plan both render the conversation, so switching between them hides nothing; only the
  // math workspace replaces the conversation entirely.
  const showStrip = running && !awaitingApproval && mode === 'math';

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-mode-shell={mode}>
      {showStrip ? (
        <div
          data-cross-mode-strip
          className="flex shrink-0 items-center gap-2 border-b border-info/30 bg-info/8 px-4 py-1.5 text-[11.5px] text-info"
        >
          <span className="min-w-0 flex-1 truncate">
            {tr('mode.elsewhere', { mode: tr('mode.chat') })}
          </span>
          <button
            type="button"
            data-cross-mode-view
            className="shrink-0 rounded border border-info/40 px-2 py-[2px] text-[11px] hover:bg-info/10"
            onClick={() => setMode('chat')}
          >
            {tr('mode.elsewhere.cta')}
          </button>
        </div>
      ) : null}

      {mode === 'chat' ? <ChatWorkspace /> : null}
      {mode === 'plan' ? <PlanWorkspace /> : null}
      {mode === 'math' ? <MathWorkspace /> : null}
    </div>
  );
}
