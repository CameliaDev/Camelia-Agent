/**
 * Fresh / blank session detection for ChatGPT-style empty chrome.
 *
 * A session is "fresh" when the active projection has no chat turns, no pending
 * ask, and no task — the composer should sit in the middle of the pane, and
 * 「新建」 should reuse this row instead of stacking another empty session.
 * @module
 */

import type { ProjectionSnapshot } from '@camelia/agent/view';

export function isFreshChatSession(snapshot: ProjectionSnapshot): boolean {
  const chat = snapshot.chat;
  if (!chat) return true;
  if (chat.turns.length > 0) return false;
  if (chat.pendingAsk) return false;
  if (snapshot.task) return false;
  return true;
}
