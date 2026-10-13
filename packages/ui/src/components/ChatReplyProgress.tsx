/**
 * Minimal in-flight reply indicator — two green dots joined by a thin green line.
 *
 * Shown only while a Work chat reply is in flight (after the user sends, until the
 * assistant turn finishes streaming or fails). Not the old % stage rail.
 * @module
 */

import type { ReactNode } from 'react';

import type { ChatView } from '@camelia/agent/view';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';

/** True from user send until the assistant turn stops streaming (or fails). */
export function isChatReplyInFlight(chat: ChatView): boolean {
  if (chat.pendingAsk) return false;
  if (chat.turns.some((turn) => turn.role === 'assistant' && turn.streaming)) return true;
  const last = chat.turns[chat.turns.length - 1];
  return last?.role === 'user';
}

export function ChatReplyProgress(): ReactNode {
  const chat = useUiStore((s) => s.snapshot.chat);
  const language = useUiStore((s) => s.localPrefs.language);
  if (!isChatReplyInFlight(chat)) return null;

  return (
    <div
      data-chat-reply-progress
      className="flex shrink-0 items-center px-4 py-1.5"
      role="progressbar"
      aria-busy="true"
      aria-label={t(language, 'chat.running')}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" data-progress-dot="start" />
      <span
        className="mx-0 h-px min-w-0 flex-1 bg-ok camelia-pulse"
        data-progress-line
        aria-hidden
      />
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" data-progress-dot="end" />
    </div>
  );
}