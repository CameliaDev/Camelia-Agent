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
import {
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
  setLocalPrefs: (patch: Partial<LocalPrefs>) => void;
  setSettingsOpen: (open: boolean) => void;
  /** Switch the active session id locally (after new_session / select_session ack). */
  setActiveSession: (id: Id) => void;
  restoreDefaultLayout: () => void;
  dispatch: (command: Command) => void;
  /** Send a command and await the engine's answer (`onCommandResult`). */
  query: <T>(command: Command) => Promise<T>;
}

export type UiStore = UseBoundStore<StoreApi<UiState>>;

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
    ...(bootTheme
      ? { activeTheme: { id: bootPrefs.themeId, label: themeLabel(bootPrefs.themeId), rejected: bootTheme.rejected } }
      : {}),
    setSettingsOpen: (open) => set({ settingsOpen: open }),
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
          leftWidth: 260,
          rightWidth: 360,
          leftCollapsed: false,
          rightCollapsed: true,
          userSetRightRail: true,
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
      try {
        const items = await store.getState().query<MemoryView[]>(makeCommand('list_memories', {}));
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
    store.setState((state) => ({ snapshot: reduceEvents(state.snapshot, [event]) }));
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
        store.setState((state) => ({
          sessions: payload.sessions,
          activeSessionId: payload.session?.id ?? payload.sessions[0]?.id,
          snapshot: withProviderStatus(
            payload.session ? withSession(state.snapshot, payload.session) : state.snapshot,
            payload.providerStatus,
          ),
        }));
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