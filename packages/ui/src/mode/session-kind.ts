/**
 * Which conversation a mode is allowed to show.
 *
 * Work, Math and Term do not share a transcript. A session with no kind is a
 * work session — that is how every row created before kinds existed is stored.
 * @module
 */

import type { SessionView } from '@camelia/agent/view';

import type { AppModeId } from './types.js';

export type SessionKind = 'work' | 'math' | 'term';

export function sessionKind(session: { kind?: string } | undefined): SessionKind {
  if (session?.kind === 'math' || session?.kind === 'term') return session.kind;
  return 'work';
}

/**
 * Whether the projected session belongs to this mode.
 *
 * No session at all matches Work (the empty composer). Math and Term with no
 * session of their own must not fall through to the work transcript.
 */
export function projectionMatchesMode(
  snapshot: { session?: { kind?: string } },
  mode: AppModeId,
): boolean {
  if (!snapshot.session) return mode === 'work';
  return sessionKind(snapshot.session) === mode;
}

/** First listed session of this kind, if the rail already has one. */
export function sessionForMode(sessions: readonly SessionView[], mode: AppModeId): SessionView | undefined {
  return sessions.find((session) => sessionKind(session) === mode);
}
