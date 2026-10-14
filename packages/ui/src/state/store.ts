/**
 * The UI store.
 *
 * One rule, taken straight from whitepaper §6.1: the store never invents business
 * state. It holds the latest `ProjectionSnapshot` (a pure fold of the domain event
 * stream) plus the connection status and the session list. Every mutation comes from
 * an event arriving through the transport; every user action leaves as a `Command`.
 *
 * That is what makes the UI replayable, testable and auditable: given the same event
 * stream, the store reaches the same state — there is no hidden client-side truth.
 *
 * The memory panel (Iteration 22) is the one deliberate exception, and it is narrow:
 * the panel is a *query surface*, not an event projection — the engine answers
 * `listMemories` / `getMemory` / `listForgetLog` / `listReactivationDue` /
 * `getMemoryHealth` over the same command channel, and the store holds those answers
 * verbatim for rendering. The data is still engine data (never fixture, never invented):
 * the UI is displaying what `SqliteSessionStore` returned, exactly as it would show a
 * tool result. User interventions (`markMemoryIncorrect` / `forgetMemory` /
 * `promoteMemory`) leave as commands and surface through the same bus events
 * (`memory.downgraded` / `memory.forgotten` / `memory.promoted`) as task-driven ones.
 *
 * The `localPrefs` slice (Iteration 23) is the other exception, and it is
 * narrower still: rail collapse, widths, theme, motion and window geometry are
 * window chrome, not business state. They live beside `snapshot` and are never
 * folded into it. See `local-prefs.ts`.
 * @module
 */

import type { Command, CommandMap, CommandType, DomainEvent, Id, MemoryLayer } from '@camelia/core';
import {
  initialSnapshot,
  reduceEvents,
  withProviderStatus,
  withSession,
  type ForgetLogView,
  type MemoryHealthView,
  type MemoryView,
  type ProjectionSnapshot,
  type SessionView,
} from '@camelia/agent/view';
import { create, type UseBoundStore, type StoreApi } from 'zustand';

import type { ConnectionStatus, Transport } from '../transport/types.js';
import { normalizeModeId, type AppModeId } from '../mode/types.js';
import type { MathDemoSnapshot } from '../modes/math/mathDemoFixture.js';
import { defaultPanelForMode, type PanelId } from '../panels.js';
import {
  RAIL_LEFT_DEFAULT,
  applySavedTheme,
  loadLocalPrefs,
  sanitizeLocalPrefs,
  saveLocalPrefs,
  syncLang,
  syncMotion,
  type LocalPrefs,
} from './local-prefs.js';
import { themeLabel } from '../theme/presets.js';

export interface MemoryPanelState {
  /** Layer filter for the visible list. */
  layerFilter: MemoryLayer | 'all';
  /** All memories as returned by `list_memories` — filtered client-side for tabs. */
  items: MemoryView[];
  forgetLog: ForgetLogView[];
  reactivationDue: MemoryView[];
  /** Health snapshot from `get_memory_health` (recall-noise rate, layer counts). */
  health?: MemoryHealthView;
  loading: boolean;
  /** Last query/intervention failure, surfaced in the panel. */
  error?: string;
}

export interface MemoryPanelActions {
  /** Load all four panel surfaces from the engine and refresh the health chip. */
  load: () => Promise<void>;
  setLayer: (layer: MemoryLayer | 'all') => void;
  /** Mark a memory known-bad; reloads the panel afterwards. */
  markIncorrect: (memoryId: Id, reason?: string) => Promise<void>;
  /** Forget a memory with an audit-trail entry; reloads the panel afterwards. */
  forget: (memoryId: Id, reason?: string) => Promise<void>;
  /** Promote one short-term memory to long-term; reloads the panel afterwards. */
  promote: (memoryId: Id) => Promise<void>;
}

export interface UiState {
  snapshot: ProjectionSnapshot;
  status: ConnectionStatus;
  sessions: SessionView[];
  activeSessionId?: Id;
  /** Last command dispatched upward — surfaced in the audit drawer and asserted in tests. */
  lastCommand?: Command;
  /** Fatal transport problem (distinct from a task failure). */
  transportError?: string;
  /** Last rejected command (engine said no). Not a dead transport. */
  lastCommandError?: { type: string; error: string; at: number };
  clearCommandError: () => void;
  /**
   * The theme in force, plus any tokens it asked for that were refused.
   *
   * Kept in state rather than only in the DOM so the UI can *tell the user* a
   * theme was partly rejected — a theme that silently fails to apply looks
   * identical to one that was never installed.
   */
  activeTheme?: {
    id: string;
    label?: string;
    rejected: Array<{ token: string; reason: string }>;
  };
  memory: MemoryPanelState;
  memoryActions: MemoryPanelActions;
  /** Window chrome. Never derived from the event stream. */
  localPrefs: LocalPrefs;
  /** Ephemeral. Not persisted and not part of `snapshot`. */
  settingsOpen: boolean;
  /**
   * Which settings page is showing. Ephemeral, like the drawer itself.
   *
   * It lives on the store rather than inside the drawer because the shell has two entries
   * that open *different* pages — the rail's account mark lands on account, the gear on
   * the first page — and a drawer-local `useState` cannot be told where to start.
   */
  settingsSection: SettingsSection;
  /**
   * Which section the right drawer is showing, or `undefined` when the drawer is closed.
   *
   * On the store, like `steeringOpen`: the toggle lives in `ModeHeader` and the drawer
   * is drawn by `App`. A local `useState` in either would give the two ends different answers.
   */
  panelId?: PanelId;
  /** Section to restore the next time the drawer opens. */
  lastPanelId?: PanelId;
  /** Which left sidebar the activity bar is showing. */
  sidebarView: 'sessions' | 'extensions' | 'skills';
  setSidebarView: (view: 'sessions' | 'extensions' | 'skills') => void;
  /** Optimistic blank so the title chrome leaves the previous session immediately. */
  showPendingSession: (kind: 'work' | 'math' | 'term') => void;
  patchSessionTitle: (id: Id, title: string) => void;
  /**
   * Whether the steering form is open. Ephemeral chrome, like the settings drawer.
   *
   * It is on the store, not in the transcript, because the button that opens it lives in the
   * shared mode header — one click in any mode has to raise the same panel, wherever it is
   * drawn.
   */
  steeringOpen: boolean;
  /**
   * Active workbench mode — ephemeral chrome, like `settingsOpen`.
   *
   * Deliberately *not* in `snapshot`: all modes read the same task, so a mode can never
   * be a fact about the run. Persisting the user's preference is `localPrefs.preferredMode`;
   * this field is only "what is on screen right now".
   */
  mode: AppModeId;
  /**
   * Demo data for a mode whose backend surface does not exist yet.
   *
   * Kept in its own field — never folded into `snapshot` — so that "what the engine told
   * us" and "what we are showing to illustrate an unbuilt feature" can never be
   * confused. Everything rendered from here carries a visible 演示 badge.
   *
   * Shared between the math workspace (which steps through it) and the top bar (whose
   * progress rail must reflect the same stage).
   */
  mathDemo?: MathDemoSnapshot;
  setMode: (mode: AppModeId) => void;
  setMathDemo: (demo: MathDemoSnapshot | undefined) => void;
  setLocalPrefs: (patch: Partial<LocalPrefs>) => void;
  /**
   * Open or close the drawer, optionally naming the page it should land on.
   *
   * A plain `setSettingsOpen(true)` resets to the first page: the caller asked for
   * "settings" without naming a page, so inheriting wherever the reader last was would make
   * that entry's destination depend on history. A named page always wins.
   */
  setSettingsOpen: (open: boolean, section?: SettingsSection) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setSteeringOpen: (open: boolean) => void;
  setPanelId: (id: PanelId | undefined) => void;
  /** Open the right drawer, or close it. Restores the last section. */
  togglePanelDrawer: () => void;
  /** Switch the active session id locally (after new_session / select_session ack). */
  setActiveSession: (id: Id) => void;
  restoreDefaultLayout: () => void;
  dispatch: (command: Command) => void;
  /** Send a command and await the engine's answer (`onCommandResult`). */
  query: <T>(command: Command) => Promise<T>;
}

export type UiStore = UseBoundStore<StoreApi<UiState>>;

/** The pages the settings drawer can show. Defined here so the shell can name one. */
export type SettingsSection = 'account' | 'connections' | 'appearance' | 'engine' | 'memory' | 'about' | 'feedback';

/** Build a well-formed command envelope. The transport owns delivery; this owns shape. */
export function makeCommand<T extends CommandType>(
  type: T,
  payload: CommandMap[T],
  commandId = `cmd_${type}_${Date.now().toString(36)}`,
): Command {
  return { type, payload, commandId, traceId: `trc_${commandId}`, ts: Date.now() } as Command;
}

/**
 * Create a store bound to a transport.
 *
 * The transport is started immediately: bootstrap data lands first, then the event
 * stream. `snapshot` only ever changes through `onEvent`, so a screenshot taken after
 * replay is exactly the fold of the script — nothing else.
 */
export function createUiStore(transport: Transport): UiStore {
  // Pending query commands, keyed by commandId. `query()` registers before sending
  // so an answer arriving in the same tick cannot be dropped; a timeout guard keeps
  // a dead engine from hanging the panel forever.
  const pending = new Map<
    Id,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();

  const bootPrefs = loadLocalPrefs();
  syncMotion(bootPrefs);
  syncLang(bootPrefs);
  // Always apply the default (or saved) theme — a fresh profile with no saved
  // prefs must still render the configured default instead of the dark stylesheet root.
  const bootTheme = applySavedTheme(bootPrefs);

  const store = create<UiState>((set) => ({
    snapshot: initialSnapshot(),
    status: 'connecting',
    sessions: [],
    localPrefs: bootPrefs,
    settingsOpen: false,
    panelId: undefined,
    sidebarView: 'sessions',
    settingsSection: 'connections',
    steeringOpen: false,
    mode: normalizeModeId(bootPrefs.preferredMode),
    ...(bootTheme
      ? { activeTheme: { id: bootPrefs.themeId, label: themeLabel(bootPrefs.themeId), rejected: bootTheme.rejected } }
      : {}),
    setSettingsOpen: (open, section) =>
      set((state) => ({
        settingsOpen: open,
        // Closing leaves the page where it was, so the animation does not flip content
        // underneath a fading panel; the next plain open resets it anyway.
        settingsSection: open ? section ?? 'connections' : state.settingsSection,
      })),
    setSettingsSection: (settingsSection) => set({ settingsSection }),
    setSteeringOpen: (steeringOpen) => set({ steeringOpen }),
    setSidebarView: (sidebarView) => set({ sidebarView }),
    showPendingSession: (kind) =>
      set((state) => {
        const session: SessionView = {
          id: `pending_${kind}_${Date.now().toString(36)}`,
          title: '新会话',
          workspace: state.snapshot.session?.workspace ?? '',
          provider: state.snapshot.session?.provider ?? state.snapshot.provider.activeProvider ?? '',
          model: state.snapshot.session?.model ?? state.snapshot.provider.activeModel ?? '',
          kind,
          blank: true,
        };
        return {
          activeSessionId: session.id,
          sessions: [session, ...state.sessions.filter((row) => row.id !== session.id)],
          snapshot: { ...withSession(initialSnapshot(), session), provider: state.snapshot.provider },
        };
      }),
    patchSessionTitle: (id, title) =>
      set((state) => ({
        sessions: state.sessions.map((row) => (row.id === id ? { ...row, title } : row)),
        snapshot:
          state.snapshot.session?.id === id
            ? withSession(state.snapshot, { ...state.snapshot.session, title })
            : state.snapshot,
      })),
    setPanelId: (panelId) =>
      set((state) => ({
        panelId,
        lastPanelId: panelId ?? state.lastPanelId,
      })),
    togglePanelDrawer: () =>
      set((state) => {
        if (state.panelId) return { panelId: undefined, lastPanelId: state.panelId };
        // The drawer is an artifacts shelf. Reopening always lands on 产物;
        // run / memory / context stay a secondary menu inside the open drawer.
        const home = defaultPanelForMode(state.mode);
        return home ? { panelId: home, lastPanelId: home } : { panelId: undefined };
      }),
    setMode: (mode) => set({ mode: normalizeModeId(mode) }),
    setMathDemo: (mathDemo) => set({ mathDemo }),
    setActiveSession: (id) => set({ activeSessionId: id }),
    clearCommandError: () => set({ lastCommandError: undefined }),
    setLocalPrefs: (patch) => {
      set((state) => {
        const next = sanitizeLocalPrefs({ ...state.localPrefs, ...patch });
        saveLocalPrefs(next);
        const themeChanged = next.themeId !== state.localPrefs.themeId || next.fontMono !== state.localPrefs.fontMono;
        const motionChanged = next.motion !== state.localPrefs.motion;
        const langChanged = next.language !== state.localPrefs.language;
        if (motionChanged) syncMotion(next);
        if (langChanged) syncLang(next);
        if (!themeChanged && state.activeTheme) {
          return { localPrefs: next };
        }
        const applied = applySavedTheme(next);
        return {
          localPrefs: next,
          activeTheme: { id: next.themeId, label: themeLabel(next.themeId), rejected: applied.rejected },
        };
      });
    },
    restoreDefaultLayout: () => {
      set((state) => {
        const next = sanitizeLocalPrefs({
          ...state.localPrefs,
          leftWidth: RAIL_LEFT_DEFAULT,
          leftCollapsed: false,
        });
        saveLocalPrefs(next);
        return { localPrefs: next };
      });
    },
    memory: {
      layerFilter: 'all',
      items: [],
      forgetLog: [],
      reactivationDue: [],
      loading: false,
    },
    memoryActions: {} as MemoryPanelActions,
    dispatch: (command) => {
      transport.send(command);
      set({ lastCommand: command });
      // Switch the SSE stream to the chosen session so its history replays.
      if (command.type === 'select_session' && typeof transport.switchSession === 'function') {
        transport.switchSession(command.payload.sessionId);
      }
    },
    query: <T,>(command: Command): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        pending.set(command.commandId, {
          resolve: (value) => resolve(value as T),
          reject,
        });
        transport.send(command);
        const timer = setTimeout(() => {
          if (!pending.delete(command.commandId)) return;
          reject(new Error(`command ${command.type} timed out`));
        }, 10_000);
        timer.unref?.();
      }),
  }));

  const memoryActions: MemoryPanelActions = {
    load: async () => {
      store.setState((state) => ({ memory: { ...state.memory, loading: true, error: undefined } }));
      // Scope the list to the session on screen. The panel answers "what did this task
      // learn?"; the unscoped list mixed every session's memories together, which is why
      // the panel read as noise. Cross-session memories live behind Settings.
      const sessionId = store.getState().activeSessionId;
      if (!sessionId) {
        // No session means no task, and a task-scoped panel has nothing to show. Falling
        // back to the unscoped query here would quietly turn the panel back into the
        // "every memory in the database" dump this scope removed.
        store.setState((state) => ({
          memory: { ...state.memory, items: [], forgetLog: [], reactivationDue: [], loading: false, error: undefined },
        }));
        return;
      }
      try {
        const items = await store.getState().query<MemoryView[]>(makeCommand('list_memories', { sessionId }));
        const forgetLog = await store.getState().query<ForgetLogView[]>(makeCommand('list_forget_log', {}));
        const reactivationDue = await store.getState().query<MemoryView[]>(makeCommand('list_reactivation_due', {}));
        const health = await store.getState().query<MemoryHealthView>(makeCommand('get_memory_health', {}));
        store.setState((state) => ({
          memory: { ...state.memory, items, forgetLog, reactivationDue, health, loading: false },
        }));
      } catch (error) {
        store.setState((state) => ({
          memory: { ...state.memory, loading: false, error: error instanceof Error ? error.message : String(error) },
        }));
      }
    },
    setLayer: (layer) => {
      store.setState((state) => ({ memory: { ...state.memory, layerFilter: layer } }));
    },
    markIncorrect: async (memoryId, reason = 'user-correction') => {
      try {
        await store.getState().query(makeCommand('mark_memory_incorrect', { memoryId, reason }));
        await memoryActions.load();
      } catch (error) {
        store.setState((state) => ({
          memory: { ...state.memory, error: error instanceof Error ? error.message : String(error) },
        }));
      }
    },
    forget: async (memoryId, reason = 'manual') => {
      try {
        await store.getState().query(makeCommand('forget_memory', { memoryId, reason }));
        await memoryActions.load();
      } catch (error) {
        store.setState((state) => ({
          memory: { ...state.memory, error: error instanceof Error ? error.message : String(error) },
        }));
      }
    },
    promote: async (memoryId) => {
      try {
        await store.getState().query(makeCommand('promote_memory', { memoryId }));
        await memoryActions.load();
      } catch (error) {
        store.setState((state) => ({
          memory: { ...state.memory, error: error instanceof Error ? error.message : String(error) },
        }));
      }
    },
  };
  store.setState({ memoryActions });

    const applyEvent = (event: DomainEvent): void => {
    store.setState((state) => {
      let snapshot = reduceEvents(state.snapshot, [event]);
      let sessions = state.sessions;
      // Mirror ChatLoop.maybeTitle: the first user turn names the session in the rail
      // and ModeHeader without waiting for the next SSE bootstrap.
      if (event.type === 'chat.received') {
        const sessionId = event.sessionId;
        const text = typeof event.payload?.text === 'string' ? event.payload.text : '';
        const title = text.trim().split('\n')[0]?.slice(0, 72);
        const userTurns = (snapshot.chat?.turns ?? []).filter((turn) => turn.role === 'user');
        if (sessionId && title && userTurns.length === 1) {
          if (snapshot.session?.id === sessionId) {
            snapshot = withSession(snapshot, { ...snapshot.session, title });
          }
          let found = false;
          sessions = sessions.map((row) => {
            if (row.id !== sessionId) return row;
            found = true;
            return { ...row, title };
          });
          if (!found && snapshot.session?.id === sessionId) {
            sessions = [snapshot.session, ...sessions];
          }
        }
      }
      return { snapshot, sessions };
    });
  };

  try {
    transport.start({
      onStatus: (status) => store.setState({ status }),
      onProviderStatus: (providerStatus) => {
        store.setState((state) => ({ snapshot: withProviderStatus(state.snapshot, providerStatus) }));
      },
      onBootstrap: (payload) => {
        // The local theme is authoritative (applied at boot above). The server
        // sends its built-in theme for non-UI clients; we do not override the
        // user's chosen default on every fresh start.
        store.setState((state) => {
          const nextId = payload.session?.id ?? payload.sessions[0]?.id;
          // Compare the projected session, not activeSessionId. 「新建」 sets
          // activeSessionId before the SSE bootstrap arrives, so a check against
          // activeSessionId keeps the previous chat under the new title.
          const projectedId = state.snapshot.session?.id;
          const switched = nextId !== undefined && nextId !== projectedId;
          const base = switched ? initialSnapshot() : state.snapshot;
                    let sessions = payload.sessions ?? [];
          if (payload.session && !sessions.some((row) => row.id === payload.session!.id)) {
            sessions = [payload.session, ...sessions];
          }
          return {
            sessions,
            activeSessionId: nextId,
            snapshot: withProviderStatus(
              payload.session ? withSession(base, payload.session) : base,
              payload.providerStatus,
            ),
          };
        });
      },
      onEvent: applyEvent,
      onError: (message) => store.setState({ transportError: message }),
      onCommandRejected: (commandId, type, error) => {
        const entry = pending.get(commandId);
        if (entry) {
          pending.delete(commandId);
          entry.reject(new Error(error));
        }
        store.setState({ lastCommandError: { type, error, at: Date.now() } });
      },
      onCommandResult: (commandId, data) => {
        const entry = pending.get(commandId);
        if (!entry) return;
        pending.delete(commandId);
        entry.resolve(data);
      },
    });
  } catch (error) {
    store.setState({ status: 'offline', transportError: error instanceof Error ? error.message : String(error) });
  }

  return store;
}