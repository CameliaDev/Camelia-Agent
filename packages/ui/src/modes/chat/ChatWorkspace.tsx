/**
 * Conversation mode (Work).
 *
 * Thin wrapper: the status strip + ChatTranscript. When the session is fresh the
 * workspace shrinks to that strip — App centres the composer in the
 * remaining pane (ChatGPT-style empty state).
 * @module
 */

import { type ReactNode } from 'react';

import { projectionMatchesMode } from '../../mode/session-kind.js';
import { useUiStore } from '../../state/UiProvider.js';
import { isFreshChatSession } from '../../state/fresh-session.js';

import { ChatReplyProgress } from '../../components/ChatReplyProgress.js';
import { ChatTranscript } from './ChatTranscript.js';

export function ChatWorkspace(): ReactNode {
  const snapshot = useUiStore((s) => s.snapshot);
  const transportError = useUiStore((s) => s.transportError);
  const aligned = projectionMatchesMode(snapshot, 'work');
  const fresh = aligned && isFreshChatSession(snapshot) && !transportError;
  return (
    <div
      className={fresh ? 'flex shrink-0 flex-col' : 'flex min-h-0 flex-1 flex-col'}
      data-chat-workspace
      data-chat-fresh={fresh || undefined}
    >
      <ChatReplyProgress />
      {fresh || !aligned ? null : <ChatTranscript />}
    </div>
  );
}
