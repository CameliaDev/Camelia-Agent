/**
 * "Start a new chat" as one shared action.
 *
 * The session column toolbar is the only chrome surface that offers it. Blank sessions
 * are reused: if the active
 * projection is already fresh, we only focus the composer; otherwise the engine's
 * `new_session` reuses an unused blank of the same kind (or creates one), then we
 * `select_session` so the SSE stream follows and bootstrap refreshes the rail. The
 * composer is centred whenever the active session is fresh (see `isFreshChatSession`).
 * @module
 */

import { useCallback } from 'react';

import { makeCommand } from './store.js';
import { useUiState } from './UiProvider.js';
import { useMode } from '../mode/useMode.js';
import { isFreshChatSession } from './fresh-session.js';

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('[data-composer] textarea')?.focus();
}

/** Focus now and once more after React/SSE remount the centred composer. */
function focusComposerSoon(): void {
  focusComposer();
  window.setTimeout(() => focusComposer(), 0);
}

export interface NewSessionOptions {
  /**
   * Do not reuse this session. Deleting the last blank must not be handed the
   * same id back — that is what made the row reappear.
   */
  excludeId?: string;
}

export function useNewSession(): (options?: NewSessionOptions) => void {
  const { query: queryEngine, setActiveSession, dispatch, snapshot, activeSessionId } = useUiState();
  const { mode } = useMode();
  return useCallback((options?: NewSessionOptions) => {
    // Callers pass `{ excludeId }` or nothing. A click event is not an options bag.
    const excludeId = typeof options?.excludeId === 'string' && options.excludeId ? options.excludeId : undefined;
    const kind = mode === 'math' ? 'math' : mode === 'term' ? 'term' : 'work';
    // Already on an unused blank — do not pile another row in the rail; land the caret
    // in the centred composer so "new chat" still feels like arriving at a clean slate.
    // A delete of that blank passes excludeId and must not take this shortcut.
    if (!excludeId && activeSessionId && isFreshChatSession(snapshot)) {
      focusComposerSoon();
      return;
    }
    queryEngine<{ sessionId: string }>(makeCommand('new_session', { kind, ...(excludeId ? { excludeId } : {}) }))
      .then((res) => {
        if (!res?.sessionId) return;
        setActiveSession(res.sessionId);
        // Same path as clicking a rail row: switch the SSE stream so bootstrap
        // reloads this session's (empty) projection and the sessions list.
        dispatch(makeCommand('select_session', { sessionId: res.sessionId }));
        focusComposerSoon();
      })
      .catch(() => {
        // Focus still lands in the composer below, so a failed round-trip leaves the user
        // where they were, ready to type, rather than on an error screen.
        focusComposerSoon();
      });
  }, [queryEngine, setActiveSession, dispatch, mode, snapshot, activeSessionId]);
}
