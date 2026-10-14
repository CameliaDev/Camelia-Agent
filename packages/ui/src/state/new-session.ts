/**
 * "Start a new chat" as one shared action.
 *
 * 「新建」 creates a session of the current mode unless the aligned row is an
 * unused blank (`blank`, or a fresh session titled 新会话 / New chat / New session).
 * Math creates immediately with the default contest profile. The setup column
 * stays available from the math bar.
 * @module
 */

import { useCallback } from 'react';

import { isReusableBlank } from '../mode/aligned-view.js';
import { makeCommand } from './store.js';
import { setMathProfile } from './shell-extras.js';
import { useUiState } from './UiProvider.js';
import { useMode } from '../mode/useMode.js';

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
  const { query: queryEngine, setActiveSession, dispatch, snapshot, showPendingSession } = useUiState();
  const { mode } = useMode();
  return useCallback((options?: NewSessionOptions) => {
    // Callers pass `{ excludeId }` or nothing. A click event is not an options bag.
    const excludeId = typeof options?.excludeId === 'string' && options.excludeId ? options.excludeId : undefined;
    const kind = mode === 'math' ? 'math' : mode === 'term' ? 'term' : 'work';
    if (!excludeId && isReusableBlank(snapshot, mode)) {
      focusComposerSoon();
      return;
    }
    showPendingSession(kind);
    queryEngine<{ sessionId: string }>(makeCommand('new_session', { kind, ...(excludeId ? { excludeId } : {}) }))
      .then((res) => {
        if (!res?.sessionId) return;
        if (kind === 'math') setMathProfile(res.sessionId, { contest: 'cumcm', useTemplates: true });
        setActiveSession(res.sessionId);
        dispatch(makeCommand('select_session', { sessionId: res.sessionId }));
        focusComposerSoon();
      })
      .catch(() => {
        focusComposerSoon();
      });
  }, [queryEngine, setActiveSession, dispatch, mode, snapshot, showPendingSession]);
}
