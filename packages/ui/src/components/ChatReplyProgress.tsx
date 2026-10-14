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

function hasVisibleAnswer(turn: ChatTurnView): boolean {
  return splitThinking(turn.text).answer.trim().length > 0;
}

/**
 * Derive the header status from the chat projection.
 *
 * Waiting on the model (a user turn with no assistant yet, or a streaming
 * turn that has not produced answer text) is 思考中. Answer text in flight is
 * 回复中. A finished assistant turn is 已完成, including when that turn left
 * an ask picker open. An empty transcript is idle.
 */
export function chatRunStatus(
  chat: ChatView,
  lastCommandError?: { type: string; error: string; at: number } | null,
): ChatRunStatus {
  if (chat.pendingAsk) {
    const asked = chat.turns[chat.turns.length - 1];
    if (asked?.role === 'assistant' && !asked.streaming && !asked.error) return 'done';
    return 'idle';
  }

  const last = chat.turns[chat.turns.length - 1];
  if (last?.role === 'assistant' && last.error) return 'error';

  const streaming = chat.turns.filter((turn) => turn.role === 'assistant' && turn.streaming);
  if (streaming.length > 0) {
    return streaming.some(hasVisibleAnswer) ? 'replying' : 'thinking';
  }

  if (last?.role === 'user') {
    if (lastCommandError && lastCommandError.at >= last.at) return 'error';
    return 'thinking';
  }

  if (last?.role === 'assistant') return 'done';
  return 'idle';
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
      <span className={`truncate text-center text-[12px] font-medium ${STATUS_CLASS[status]}`}>{label}</span>
    </div>
  );
}
