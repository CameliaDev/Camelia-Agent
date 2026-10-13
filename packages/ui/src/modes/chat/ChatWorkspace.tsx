/**
 * Conversation mode.
 *
 * The default surface and the original product path: the running record of the task, with
 * the activity bar above it. This module is a thin wrapper — the conversation body is
 * `modes/chat/ChatTranscript.tsx`, the direct conversation path.
 *
 * It exists because chat and plan now diverge at the *workspace* level (plan mode gets the
 * plan review as its primary surface, chat gets the transcript), while both still draw the
 * same 33px `ModeHeader` — one mode, one strip, at zero turns included. Keeping the
 * wrapper explicit is what lets `ModeShell` stay a one-line dispatch.
 * @module
 */

import { type ReactNode } from 'react';

import { ModeHeader } from '../ModeHeader.js';

import { ChatTranscript } from './ChatTranscript.js';

/**
 * 对话 mode renders the direct conversation path (`snapshot.chat`).
 *
 * It used to render `Conversation` — the task transcript — which is why typing
 * "hello" went through goal restatement, drift warnings and UNKNOWN-manual
 * acceptance: the surface was a task surface, so the engine was asked to run one.
 * Plan mode keeps `Conversation`; the two modes now visibly differ at the
 * workspace level, which is what `ModeShell`'s one-line dispatch was waiting for.
 */
export function ChatWorkspace(): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-chat-workspace>
      <ModeHeader />
      <ChatTranscript />
    </div>
  );
}
