/**
 * Work-chat status strip.
 *
 * The column used to draw a thin green (or red) rule with a dot at each end,
 * plus a separate pill in the transcript. The rule was shorter than the
 * artifacts header beside it, so the two columns did not share a top edge.
 *
 * This strip is that header: the same fixed height as the 「产物」 row, with
 * one centred status and no progress rule. Phases the rest of the shell still
 * treats as "in flight" stay `running` via {@link chatReplyProgressPhase}.
 * @module
 */

import type { ReactNode } from 'react';

import type { ChatTurnView, ChatView } from '@camelia/agent/view';

import { t } from '../i18n/strings.js';
import { splitThinking } from '../lib/thinking.js';
import { MODE_HEADER_H } from '../modes/ModeHeader.js';
import { useUiStore } from '../state/UiProvider.js';

export type ChatReplyProgressPhase = 'hidden' | 'running' | 'error';

/** What the centred header says. `idle` is the quiet equivalent of "nothing in flight". */
export type ChatRunStatus = 'idle' | 'thinking' | 'replying' | 'done' | 'error';

const STATUS_KEY: Record<ChatRunStatus, Parameters<typeof t>[1]> = {
  idle: 'chat.idle',
  thinking: 'chat.thinking',
  replying: 'chat.running',
  done: 'chat.done',
  error: 'chat.failed',
};

const STATUS_CLASS: Record<ChatRunStatus, string> = {
  idle: 'text-ink-3',
  thinking: 'text-ink',
  replying: 'text-ink',
  done: 'text-ink-2',
  error: 'text-bad',
};

/**
 * Status pill for the top bar — one line, quiet, sized for the 36px bar, so the
 * title and its run status sit on the same line instead of a second strip below.
 */
export const CHAT_STATUS_PILL_CLASS =
  'shrink-0 whitespace-nowrap rounded-full border border-line/70 bg-base px-2 py-px text-[11px] leading-4';

export { STATUS_KEY, STATUS_CLASS };

/**
 * One line, bold, and large enough to read as the column's status — still
 * inside the 33px strip that matches the artifacts header.
 */
const STATUS_LABEL_CLASS = 'truncate text-center text-[16px] font-bold leading-5';

function hasVisibleAnswer(turn: ChatTurnView): boolean {
  return splitThinking(turn.text).answer.trim().length > 0;
}

function toolsStillRunning(turn: ChatTurnView): boolean {
  return turn.toolCalls.some(
    (call) =>
      call.status === 'pending' ||
      call.status === 'awaiting-approval' ||
      call.status === 'approved' ||
      call.status === 'running',
  );
}

/**
 * Derive the header status from the chat run, not from a leftover caret flag.
 *
 * `streaming` means "deltas are still arriving for this turn". A tool round
 * opens a turn and often never clears that flag. The run itself is
 * `chat.inflight` (set on `chat.received`, cleared when the run settles).
 * While that is set: 思考中 until the latest turn has answer text, then 回复中.
 * Once the run has settled, the latest assistant turn is 已完成 — an earlier
 * tool round left `streaming` must not pin the header on 思考中.
 * An empty transcript (or a settled run with no assistant turn) is 空闲.
 */
export function chatRunStatus(
  chat: ChatView,
  lastCommandError?: { type: string; error: string; at: number } | null,
): ChatRunStatus {
  const last = chat.turns[chat.turns.length - 1];

  if (chat.pendingAsk) {
    if (last?.role === 'assistant' && !last.streaming && !last.error) return 'done';
    return 'idle';
  }

  if (last?.role === 'assistant' && last.error) return 'error';
  if (last?.role === 'user' && lastCommandError && lastCommandError.at >= last.at) return 'error';

  if (chat.inflight) {
    if (last?.role === 'assistant' && hasVisibleAnswer(last)) return 'replying';
    return 'thinking';
  }

  // Explicitly settled: the loop emitted its terminal message or failure.
  // Ignore a caret flag that a tool round never cleared.
  if (chat.inflight === false) {
    if (last?.role === 'assistant') return 'done';
    return 'idle';
  }

  // Older snapshots and direct fixtures have no run bit. The latest turn is
  // the phase; streaming on an earlier tool round is not.
  if (!last) return 'idle';
  if (last.role === 'user') return 'thinking';
  if (last.streaming || toolsStillRunning(last)) {
    return hasVisibleAnswer(last) ? 'replying' : 'thinking';
  }
  return 'done';
}

/** Coarse phase kept for in-flight checks. Idle and done are both "not running". */
export function chatReplyProgressPhase(
  chat: ChatView,
  lastCommandError?: { type: string; error: string; at: number } | null,
): ChatReplyProgressPhase {
  const status = chatRunStatus(chat, lastCommandError);
  if (status === 'error') return 'error';
  if (status === 'thinking' || status === 'replying') return 'running';
  return 'hidden';
}

/** True only while a reply is actively in flight (thinking or answering). */
export function isChatReplyInFlight(chat: ChatView): boolean {
  return chatReplyProgressPhase(chat) === 'running';
}

export function ChatReplyProgress(): ReactNode {
  const chat = useUiStore((s) => s.snapshot.chat);
  const lastCommandError = useUiStore((s) => s.lastCommandError);
  const language = useUiStore((s) => s.localPrefs.language);
  const status = chatRunStatus(chat, lastCommandError);
  const phase = chatReplyProgressPhase(chat, lastCommandError);
  const label = t(language, STATUS_KEY[status]);

  return (
    <div
      data-chat-status
      data-chat-reply-progress
      data-status={status}
      data-phase={phase}
      style={{ height: MODE_HEADER_H }}
      className="flex shrink-0 items-center justify-center border-b border-line/70 bg-base px-3"
      role="status"
      aria-live="polite"
    >
      <span data-chat-status-label className={`${STATUS_LABEL_CLASS} ${STATUS_CLASS[status]}`}>
        {label}
      </span>
    </div>
  );
}
