/**
 * What the shell may show for the mode that is on screen.
 *
 * A Work transcript must not paint under Math or Term. A running task elsewhere
 * still keeps the run dock; an idle foreign session looks like an empty mode.
 * @module
 */

import type { ProjectionSnapshot } from '@camelia/agent/view';

import { isFreshChatSession } from '../state/fresh-session.js';
import { projectionMatchesMode } from './session-kind.js';
import type { AppModeId } from './types.js';

const REUSABLE_TITLES = new Set(['', '新会话', 'New chat', 'New session']);

/** Centred empty hero. Term never uses it. A foreign idle session does. */
export function shellIsFresh(
  snapshot: ProjectionSnapshot,
  mode: AppModeId,
  transportError: boolean,
): boolean {
  if (transportError) return false;
  if (mode === 'term') return false;
  if (!projectionMatchesMode(snapshot, mode)) return snapshot.task === undefined;
  return isFreshChatSession(snapshot);
}

/**
 * 「新建」 may focus this row instead of creating another.
 *
 * A titled session with no events (workspace basename, a finished "hello") is
 * not reusable. Only an explicit blank is.
 */
export function isReusableBlank(snapshot: ProjectionSnapshot, mode: AppModeId): boolean {
  const session = snapshot.session;
  if (!session) return false;
  if (!projectionMatchesMode(snapshot, mode)) return false;
  if (session.blank === true) return true;
  if (!isFreshChatSession(snapshot)) return false;
  return REUSABLE_TITLES.has(session.title?.trim() ?? '');
}
