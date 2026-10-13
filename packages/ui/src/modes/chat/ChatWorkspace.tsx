/**
 * Conversation mode (Work).
 *
 * Thin wrapper: ModeHeader + ChatTranscript. When the session is fresh the
 * workspace shrinks to the header only — App centres the composer in the
 * remaining pane (ChatGPT-style empty state).
 * @module
 */

import { type ReactNode } from 'react';

import { ModeHeader } from '../ModeHeader.js';
import { useUiStore } from '../../state/UiProvider.js';
import { isFreshChatSession } from '../../state/fresh-session.js';

import { ChatReplyProgress } from '../../components/ChatReplyProgress.js';
import { ChatTranscript } from './ChatTranscript.js';

export function ChatWorkspace(): ReactNode {
  const snapshot = useUiStore((s) => s.snapshot);
  const transportError = useUiStore((s) => s.transportError);
  const fresh = isFreshChatSession(snapshot) && !transportError;
  return (
    <div
      className={fresh ? 'flex shrink-0 flex-col' : 'flex min-h-0 flex-1 flex-col'}
      data-chat-workspace
      data-chat-fresh={fresh || undefined}
    >
      <ModeHeader />
      <ChatReplyProgress />
      {fresh ? null : <ChatTranscript />}
    </div>
  );
}
