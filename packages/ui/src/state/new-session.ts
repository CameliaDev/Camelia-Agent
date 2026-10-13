/**
 * "Start a new chat" as one shared action.
 *
 * Two chrome surfaces offer it — the session column's header and the permanent icon rail —
 * and they have to do exactly the same thing: ask the engine for a session id, adopt it,
 * and put the caret in the composer. Keeping the body in one hook is what stops the two
 * drifting (one of them forgetting `setActiveSession`, say, which only shows up as the
 * rail and the list disagreeing about which chat is current).
 * @module
 */

import { useCallback } from 'react';

import { makeCommand } from './store.js';
import { useUiState } from './UiProvider.js';

export function useNewSession(): () => void {
  const { query: queryEngine, setActiveSession } = useUiState();
  return useCallback(() => {
    queryEngine<{ sessionId: string }>(makeCommand('new_session', {}))
      .then((res) => {
        if (res?.sessionId) setActiveSession(res.sessionId);
      })
      .catch(() => {
        // Focus still lands in the composer below, so a failed round-trip leaves the user
        // where they were, ready to type, rather than on an error screen.
      });
    document.querySelector<HTMLTextAreaElement>('[data-composer] textarea')?.focus();
  }, [queryEngine, setActiveSession]);
}
