/**
 * Minimal in-flight reply indicator — two dots joined by a thin line.
 *
 * Phases:
 * - running (green): after the user sends, until the assistant turn finishes.
 * - error (red): chat.failed on the assistant turn, or a command rejection after
 *   the latest user send (quota / auth / etc.). Stays until the next send.
 * - hidden: idle or a successful finished turn.
 *
 * Animation is opacity-only (no scale) so the thin line does not stutter.
 * @module
 */

import type { ReactNode } from 'react';

import type { ChatView } from '@camelia/agent/view';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';

export type ChatReplyProgressPhase = 'hidden' | 'running' | 'error';

/** Derive the reply-bar phase from chat projection + optional command failure. */
export function chatReplyProgressPhase(
  chat: ChatView,
  lastCommandError?: { type: string; error: string; at: number } | null,
): ChatReplyProgressPhase {
  if (chat.pendingAsk) return 'hidden';

  const last = chat.turns[chat.turns.length - 1];
  if (last?.role === 'assistant' && last.error) return 'error';
  if (chat.turns.some((turn) => turn.role === 'assistant' && turn.streaming)) return 'running';
  if (last?.role === 'user') {
    if (lastCommandError && lastCommandError.at >= last.at) return 'error';
    return 'running';
  }
  return 'hidden';
}

/** True only while a reply is actively in flight (green phase). */
export function isChatReplyInFlight(chat: ChatView): boolean {
  return chatReplyProgressPhase(chat) === 'running';
}

export function ChatReplyProgress(): ReactNode {
  const chat = useUiStore((s) => s.snapshot.chat);
  const lastCommandError = useUiStore((s) => s.lastCommandError);
  const language = useUiStore((s) => s.localPrefs.language);
  const phase = chatReplyProgressPhase(chat, lastCommandError);
  if (phase === 'hidden') return null;

  const dotClass =
    phase === 'error'
      ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-bad'
      : 'h-1.5 w-1.5 shrink-0 rounded-full bg-ok';
  const lineClass =
    phase === 'error'
      ? 'mx-0 h-px min-w-0 flex-1 bg-bad'
      : 'mx-0 h-px min-w-0 flex-1 bg-ok camelia-reply-bar';
  const label = phase === 'error' ? t(language, 'chat.failed') : t(language, 'chat.running');

  return (
    <div
      data-chat-reply-progress
      data-phase={phase}
      className="flex shrink-0 items-center px-4 py-1.5"
      role="progressbar"
      aria-busy={phase === 'running' ? 'true' : 'false'}
      aria-label={label}
    >
      <span className={dotClass} data-progress-dot="start" />
      <span className={lineClass} data-progress-line aria-hidden />
      <span className={dotClass} data-progress-dot="end" />
    </div>
  );
}
