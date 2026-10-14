/**
 * Mode shell — Work | Math work areas + cross-mode strip (P0-2 / F6).
 *
 * Task surface lives in Work (inline TaskRunCard). Math replaces it entirely, so a
 * running task while looking at Math shows the elsewhere strip with CTA back to Work.
 * @module
 */

import { useEffect, useRef, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { useMode } from '../mode/useMode.js';
import { ChatWorkspace } from './chat/ChatWorkspace.js';
import { MathWorkspace } from './math/MathWorkspace.js';
import { TermWorkspace } from './term/TermWorkspace.js';
import { isFreshChatSession } from '../state/fresh-session.js';

export function ModeShell(): ReactNode {
  const { mode, setMode } = useMode();
  const task = useUiStore((s) => s.snapshot.task);
  const snapshot = useUiStore((s) => s.snapshot);
  const transportError = useUiStore((s) => s.transportError);
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(language, k, params);

  const running = task !== undefined && task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled';
  const awaitingApproval = task?.status === 'awaiting-approval';

  const dismissed = useRef<Set<string>>(new Set());
  const taskId = task?.id;
  useEffect(() => {
    if (taskId === undefined) dismissed.current.clear();
  }, [taskId]);

  // First time a task awaits approval, bring the user to Work (task card + PlanReview).
  // Term keeps its own approve row so a team plan does not abandon the timeline.
  useEffect(() => {
    if (!awaitingApproval || !taskId) return;
    if (mode === 'work' || mode === 'term') return;
    if (dismissed.current.has(taskId)) return;
    setMode('work');
  }, [awaitingApproval, taskId, mode, setMode]);

  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === 'work' && mode !== 'work' && awaitingApproval && taskId) {
      dismissed.current.add(taskId);
    }
    lastMode.current = mode;
  }, [mode, awaitingApproval, taskId]);

  // Task surface is Work only — strip when Math hides it.
  const showStrip = running && !awaitingApproval && (mode === 'math' || mode === 'term');
  const fresh = (mode === 'work' || mode === 'math') && isFreshChatSession(snapshot) && !transportError;

  return (
    <div
      className={fresh ? 'flex shrink-0 flex-col' : 'flex min-h-0 flex-1 flex-col'}
      data-mode-shell={mode}
      data-mode-fresh={fresh || undefined}
    >
      {showStrip ? (
        <div
          data-cross-mode-strip
          className="flex shrink-0 items-center gap-2 border-b border-info/30 bg-info/8 px-4 py-1.5 text-[11.5px] text-info"
        >
          <span className="min-w-0 flex-1 truncate">
            {tr('mode.elsewhere', { mode: tr('mode.work') })}
          </span>
          <button
            type="button"
            data-cross-mode-view
            className="shrink-0 rounded border border-info/40 px-2 py-[2px] text-[11px] hover:bg-info/10"
            onClick={() => setMode('work')}
          >
            {tr('mode.elsewhere.cta')}
          </button>
        </div>
      ) : null}

      {mode === 'work' ? <ChatWorkspace /> : null}
      {mode === 'math' ? <MathWorkspace /> : null}
      {mode === 'term' ? <TermWorkspace /> : null}
    </div>
  );
}
