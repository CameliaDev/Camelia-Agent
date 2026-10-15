/**
 * Conversation mode (Work).
 *
 * Thin wrapper: ChatTranscript (run status lives in TopBar). When the session is fresh the
 * workspace shrinks to that strip — App centres the composer in the
 * remaining pane (ChatGPT-style empty state).
 * @module
 */

import { type ReactNode } from 'react';

import { projectionMatchesMode } from '../../mode/session-kind.js';
import { useUiStore } from '../../state/UiProvider.js';
import { isFreshChatSession } from '../../state/fresh-session.js';

import { ChatTranscript } from './ChatTranscript.js';
import { WorkPlanList } from './WorkPlanList.js';

export function ChatWorkspace(): ReactNode {
  const snapshot = useUiStore((s) => s.snapshot);
  const transportError = useUiStore((s) => s.transportError);
  const aligned = projectionMatchesMode(snapshot, 'work');
  const fresh = aligned && isFreshChatSession(snapshot) && !transportError;
  const plans = snapshot.work?.plans ?? [];
  const posture = snapshot.work?.posture ?? 'chat';
  const showPlans = aligned && !fresh && (posture !== 'chat' || plans.length > 0);
  return (
    <div
      className={fresh ? 'flex shrink-0 flex-col' : 'flex min-h-0 flex-1 flex-col'}
      data-chat-workspace
      data-chat-fresh={fresh || undefined}
    >
      {showPlans ? (
        <div className="shrink-0 px-4 pt-3">
          <WorkPlanList plans={plans} />
        </div>
      ) : null}
      {fresh || !aligned ? null : <ChatTranscript />}
    </div>
  );
}
