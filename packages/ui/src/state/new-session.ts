/**
 * "Start a new chat" as one shared action.
 *
 * Two chrome surfaces offer it — the session column's header and the permanent icon rail —
 * and they have to do exactly the same thing. Blank sessions are reused: if the active
 * projection is already fresh, we only focus the composer; otherwise the engine's
 * `new_session` reuses an unused blank of the same kind (or creates one), then we
 * `select_session` so the SSE stream follows and bootstrap refreshes the rail.
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

export function useNewSession(): () => void {
  const { query: queryEngine, setActiveSession, dispatch, snapshot, activeSessionId } = useUiState();
  const { mode } = useMode();
  return useCallback(() => {
    const kind = mode === 'math' ? 'math' : 'work';
    // Already on an unused blank — do not pile another row in the rail.
    if (activeSessionId && isFreshChatSession(snapshot)) {
      focusComposer();
      return;
    }
    queryEngine<{ sessionId: string }>(makeCommand('new_session', { kind }))
      .then((res) => {
        if (!res?.sessionId) return;
        setActiveSession(res.sessionId);
        // Same path as clicking a rail row: switch the SSE stream so bootstrap
        // reloads this session's (empty) projection and the sessions list.
        dispatch(makeCommand('select_session', { sessionId: res.sessionId }));
      })
      .catch(() => {
        // Focus still lands in the composer below, so a failed round-trip leaves the user
        // where they were, ready to type, rather than on an error screen.
      });
    focusComposer();
  }, [queryEngine, setActiveSession, dispatch, mode, snapshot, activeSessionId]);
}