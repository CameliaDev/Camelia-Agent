/**
 * Camelia runtime — the composition root.
 *
 * This is the only place where a concrete implementation is chosen for every port:
 * the model provider chain, the Node adapters, SQLite, the in-memory tracer and
 * metrics. The harness receives them through `RunContext` and stays testable
 * (whitepaper §2.2, §3).
 *
 * Layer contract: `agent` depends on `harness` and `core`; it is depended on by
 * `ui` and `cli`. It never reaches into the harness internals — everything it
 * builds is a documented public constructor.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  EventBus,
  InMemoryMetrics,
  InMemoryTracer,
  SqliteSessionStore,
  phaseOf,
  systemClock,
  type AgentPreset,
  type ChatPolicy,
  type ClarifiedIntent,
  type DomainEvent,
  type Id,
  type LoggerPort,
  type LogLevel,
  type McpServerConfig,
  type MemoryLayer,
  type MetricSample,
  type Plan,
  type PlanEdit,
  type Session,
  type SessionStore,
  type Span,
  type StoredEvent,
  type Task,
  type TaskStatus,
  type TokenBudget,
} from '@camelia/core';
import {
  AgentLoop,
  ApprovalGate,
  Clarifier,
  ContextManager,
  connectAll,
  disconnectAll,
  DriftDetector,
  ErrorRecovery,
  Executor,
  LoopDetector,
  MemoryService,
  ModelGateway,
  PlanSelfReview,
  Planner,
  PlanGate,
  SubAgentOrchestrator,
  ToolEngine,
  Verifier,
  WorkspaceJournal,
  builtinTools,
  defaultHarnessConfig,
  emptySlots,
  resolveConfig,
  type ApprovalResponder,
  type HarnessConfig,
  type HarnessPorts,
  type McpClient,
  type McpServerStatus,
  type McpTransport,
  type RunContext,
  type TaskOutcome,
  type Tool,
} from '@camelia/harness';

import { NodeFs } from '../adapters/NodeFs.js';
import { NodeSearch } from '../adapters/NodeSearch.js';
import { NodeShell } from '../adapters/NodeShell.js';
import { createLogger } from '../adapters/logger.js';
import { loadConfig, type CameliaConfig } from '../config/load.js';
import { ensureCameliaHome, paths } from '../config/paths.js';
import { appendAbiMismatch, isAbiMismatchError, migrateAbiMismatch } from './abi.js';
import { ChatLoop } from './ChatLoop.js';
import { FallbackLLMPort } from '../FallbackLLMPort.js';
import { ModelRouter } from '../ModelRouter.js';
import { PluginLoader, type PluginLoadResult, type LoadedProviderPlugin } from '../plugins/PluginLoader.js';
import { PresetRegistry } from '../presets/PresetRegistry.js';
import { ProviderRegistry, type ProviderHandle } from '../ProviderRegistry.js';
import { autoApprover, denyApprover, interactiveApprover } from './ApprovalResponders.js';
import {
  toMemoryView,
  type ForgetLogView,
  type MemoryHealthView,
  type MemoryRecallView,
  type MemoryView,
} from '../view/snapshot.js';

export interface CameliaRuntimeOptions {
  /** Absolute or relative workspace root. Resolved to an absolute path. */
  workspace: string;
  /** Pre-resolved configuration; when omitted it is loaded from env + `~/.camelia`. */
  config?: CameliaConfig;
  /** Overrides merged over the harness defaults. */
  harnessConfig?: Partial<HarnessConfig>;
  /** Explicit provider handles — used by tests and `camelia run --mock`. */
  providerHandles?: ProviderHandle[];
  /** Provider preference; moves that provider to the front of the fallback chain. */
  preferredProvider?: string;
  model?: string;
  gruntModel?: string;
  /** Custom approval responder; wins over `autoApprove`. */
  approvalResponder?: ApprovalResponder;
  /** Auto-approve every gated tool call (`--yes`). */
  autoApprove?: boolean;
  /** Plan gate. `--yes` and `--auto-approve-plan` set `auto`. Default is `always`. */
  planApproval?: 'always' | 'auto';
  /** Command used by `test-pass` acceptance points with no explicit command. */
  testCommand?: string;
  logLevel?: LogLevel;
  /** Sink for log lines; defaults to stderr. */
  logTo?: (line: string) => void;
  /** SQLite file; defaults to `~/.camelia/camelia.db`. */
  databaseFile?: string;
  /** Cap on the in-memory event buffer (replay uses the DB, this is for reports). */
  maxRecordedEvents?: number;
  /** Tool set; defaults to the built-ins. */
  tools?: Tool<any, any>[];
  /**
   * Agent preset id (whitepaper §8.3). When omitted, no preset is applied and the
   * engine behaves exactly as before — presets are opt-in, so naming one is the
   * only way to narrow the tool set or inject persona directives.
   */
  preset?: string;
  /** Directory of user `*.json` presets. Defaults to `~/.camelia/presets`. */
  presetDir?: string;
  /**
   * Directory holding per-workspace project profiles (Iteration 24). Defaults to
   * `~/.camelia/profiles`; `undefined` keeps planning profile-free.
   */
  profileDir?: string;
  /**
   * Directory where per-task run records are written (Iteration 24). Defaults to
   * `~/.camelia/runs`; `undefined` keeps the loop record-free.
   */
  runRecordDir?: string;
  /**
   * Directory scanned for plugin directories. When omitted, plugins are **not**
   * loaded — an explicit path is what makes a run's tool set reproducible.
   */
  pluginRoot?: string;
  /**
   * MCP servers to connect (whitepaper §8.5). When omitted, no MCP server is
   * contacted — same reproducibility rule as `pluginRoot`.
   */
  mcpServers?: McpServerConfig[];
  /** Injection seam for tests: build a transport per server config. */
  mcpTransportFactory?: (config: McpServerConfig) => McpTransport;
}

export interface RunTaskOptions {
  /** Skip the clarify model call and use the deterministic restatement. */
  offlineClarify?: boolean;
  /** Reuse a persisted plan (resume path). */
  plan?: Plan;
  /** Skip steps before this index (resume path). */
  startStepIdx?: number;
  /**
   * Continue an existing task instead of creating a new one (whitepaper §4.7).
   *
   * The persisted plan and the per-step statuses decide where to resume, so a task
   * interrupted by a pause or a crash continues rather than restarting from zero.
   */
  resumeTaskId?: Id;
  /**
   * Attach the new task to a specific session row instead of the runtime's own
   * session. Used by the UI "new session" / "switch session" flow.
   */
  sessionId?: Id;
}

export interface CameliaRunResult {
  outcome: TaskOutcome;
  intent: ClarifiedIntent;
  session: Session;
  task: Task;
  provider: {
    id: string;
    label: string;
    model: string;
    gruntModel: string;
    chain: { id: string; active: boolean }[];
    depth: number;
  };
  /** Context snapshot — protected slots and compaction log. */
  context: ReturnType<ContextManager['snapshot']>;
  budget: TokenBudget;
  metrics: MetricSample[];
  /** Domain events recorded during the run (log/metric events excluded). */
  events: DomainEvent[];
  /** Spans from the causal trace (metric M14). */
  trace: readonly Span[];
  /** Active agent preset, when one was named (whitepaper §8.3). */
  preset?: { id: string; label: string; allowedTools: string[] };
}

/** Mutable state shared between the runtime and the bus closures. */
interface SharedState {
  events: DomainEvent[];
  persist: Promise<void>;
  sessionId?: Id;
}

/**
 * The memory panel's read/write surface (Iteration 22).
 *
 * Query methods return views with the engine's value decomposition
 * pre-computed; intervention methods return `{ ok, error? }` and emit the
 * same observable events (`memory.downgraded` / `memory.forgotten` /
 * `memory.promoted`) as the task-driven paths, so the UI timeline stays a
 * faithful projection of the engine.
 */
export interface MemoryPanelFacade {
  /**
   * List memories for the panel.
   *
   * `sessionId` scopes the list to what *that session* learned; without it the
   * list is every memory the engine holds, which is the "all memories" view the
   * Settings surface uses. The panel itself always passes the active session —
   * see the scope note on the `list_memories` command.
   */
  list(query?: { layer?: MemoryLayer; sessionId?: Id }): Promise<MemoryView[]>;
  get(memoryId: Id): Promise<MemoryView | null>;
  forgetLog(limit?: number): Promise<ForgetLogView[]>;
  reactivationDue(limit?: number): Promise<MemoryView[]>;
  markIncorrect(memoryId: Id, reason: string): Promise<{ ok: boolean; error?: string }>;
  forget(memoryId: Id, reason: string): Promise<{ ok: boolean; error?: string }>;
  promote(memoryId: Id): Promise<{ ok: boolean; error?: string }>;
  health(): Promise<MemoryHealthView>;
  /**
   * Recall timeline (Iteration 26): persisted `memory.recalled` hits with layer,
   * content snippet, matchedBy, noise and the later-downgrade annotation.
   */
  recallTimeline(query?: { memoryId?: Id; sessionId?: Id; since?: number; limit?: number }): Promise<MemoryRecallView[]>;
}

/**
 * The session this engine should work in.
 *
 * A fresh engine used to create a session unconditionally, so every launch left another
 * empty row titled after the workspace. One real install collected **26 of them** — all
 * noise in the session rail, none containing work, and the title indistinguishable from
 * real sessions because it is just `basename(workspace)`.
 *
 * Reopening this workspace's most recently touched session instead gives the continuity a
 * chat surface implies: the user comes back to the conversation they left. `新建` is still
 * there for anyone who wants a clean one, and the rail keeps every session it already has.
 *
 * A workspace with no history still gets a session — `run` needs one to attach the task to.
 */
async function openWorkspaceSession(
  store: SqliteSessionStore,
  workspace: string,
  provider: string,
  model: string,
): Promise<Session> {
  const recent = await store.listSessions();
  const existing = recent.find((candidate) => candidate.workspace === workspace);
  if (existing) return existing;
  return store.createSession({
    title: path.basename(workspace) || workspace,
    workspace,
    provider,
    model,
  });
}

/**
 * Move tasks that a dead process left mid-flight into `paused`.
 *
 * A run lives in the process that started it: the plan gate is an in-memory promise, the
 * loop owns the abort controller, and the store is only a record of what happened. When
 * that process goes away — a restart, a crash, closing the window — the task keeps its
 * mid-flight status in the database and nothing is left that can ever advance it.
 *
 * The visible symptom is `awaiting-approval`. The shell restores such a task, routes to
 * plan mode, renders 批准, and the click fails with 「没有待审批的计划」 because the promise
 * died with the old process. The user cannot continue and cannot dismiss it. One real
 * install had seven of these, spread one per session, so the repair has to be store-wide:
 * any session in the rail can be the next one the user opens.
 *
 * `paused` is the honest status rather than a guess at the truth: the work exists, it is
 * not progressing, and the UI already renders it with a 继续 button that re-enters the loop
 * through the documented resume path. Steps, tool calls and checkpoints are untouched —
 * only the status is repaired.
 *
 * Assumes one engine per database. That is the supported configuration — the desktop shell
 * is the only long-lived engine for its workspace — and two engines on one task is already
 * broken by design. The failure mode if it happens is mild and self-healing: the other run
 * keeps going in memory and its next status write wins.
 */
async function repairOrphanedTasks(store: SessionStore): Promise<number> {
  const orphans = await store.listUnsettledTasks();
  for (const task of orphans) {
    await store.updateTask(task.id, {
      status: 'paused',
      phase: phaseOf('paused'),
      resumeTarget: task.status,
    });
  }
  return orphans.length;
}

export class CameliaRuntime {
  readonly bus: EventBus;
  readonly store: SqliteSessionStore;
  readonly metrics: InMemoryMetrics;
  readonly tracer: InMemoryTracer;
  readonly tools: ToolEngine;
  session: Session;
  readonly workspace: string;
  readonly config: CameliaConfig;
  readonly harnessConfig: HarnessConfig;
  /** The active agent preset, when one was named. */
  readonly preset?: AgentPreset;
  /** What plugin loading found — loaded plugins and every rejection, with reasons. */
  readonly plugins: PluginLoadResult;
  /**
   * Per-server MCP connection outcomes (whitepaper §8.5).
   *
   * Public so `camelia doctor` and the UI can answer "why is this tool missing?"
   * without re-running the handshake. A server that failed to connect appears here
   * with its error rather than silently contributing nothing.
   */
  readonly mcp: McpServerStatus[];

  /**
   * Memory panel facade (Iteration 22) — the visible, user-controllable surface
   * for the memory lifecycle.
   *
   * `camelia serve` maps its `listMemories / getMemory / listForgetLog /
   * listReactivationDue / markMemoryIncorrect / forgetMemory / promoteMemory`
   * commands onto these methods. The facade is backed by a runtime-level
   * MemoryService that shares the same store (and the same bus, so user
   * interventions emit the same observable events as task-driven ones) but is
   * independent of any single task run — the panel works while idle.
   */
  readonly memoryPanel: MemoryPanelFacade;

  private readonly handles: ProviderHandle[];
  private readonly ports: HarnessPorts;
  private readonly logger: LoggerPort;
  private readonly fallback: FallbackLLMPort;
  /** Runtime-level memory service backing the panel (shares the store & bus). */
  private readonly panelMemory: MemoryService;
  private readonly decision: { model: string; gruntModel: string; reason: string };
  private readonly responder?: ApprovalResponder;
  private readonly testCommand?: string;
  private readonly shared: SharedState;
  private readonly maxRecordedEvents: number;
  /** Live MCP connections, closed by {@link close}. */
  private readonly mcpClients: McpClient[] = [];
  private controller = new AbortController();
  private activeLoop?: AgentLoop;
  /** The chat path (对话 mode): direct conversation, never a task. */
  private readonly chatLoop: ChatLoop;
  private readonly planGate = new PlanGate();
  private closed = false;

  private constructor(init: {
    workspace: string;
    config: CameliaConfig;
    harnessConfig: HarnessConfig;
    session: Session;
    store: SqliteSessionStore;
    bus: EventBus;
    tracer: InMemoryTracer;
    metrics: InMemoryMetrics;
    tools: ToolEngine;
    ports: HarnessPorts;
    handles: ProviderHandle[];
    fallback: FallbackLLMPort;
    decision: { model: string; gruntModel: string; reason: string };
    responder?: ApprovalResponder;
    testCommand?: string;
    shared: SharedState;
    maxRecordedEvents: number;
    logger: LoggerPort;
    preset?: AgentPreset;
    plugins: PluginLoadResult;
    mcp?: McpServerStatus[];
    /** Live connections to hand to the instance so `close()` can tear them down. */
    mcpClients?: McpClient[];
  }) {
    this.workspace = init.workspace;
    this.config = init.config;
    this.harnessConfig = init.harnessConfig;
    this.session = init.session;
    this.store = init.store;
    this.bus = init.bus;
    this.tracer = init.tracer;
    this.metrics = init.metrics;
    this.tools = init.tools;
    this.ports = init.ports;
    this.handles = init.handles;
    this.fallback = init.fallback;
    this.decision = init.decision;
    this.responder = init.responder;
    this.testCommand = init.testCommand;
    this.shared = init.shared;
    this.maxRecordedEvents = init.maxRecordedEvents;
    this.logger = init.logger;
    this.preset = init.preset;
    this.plugins = init.plugins;
    this.mcp = init.mcp ?? [];
    if (init.mcpClients) this.mcpClients.push(...init.mcpClients);
    this.shared.sessionId = init.session.id;

    // The panel service is runtime-scoped: it outlives any single task run, so
    // the memory panel works while the engine is idle, and its interventions
    // emit the same events through the same bus as task-driven memory policy.
    this.panelMemory = new MemoryService({
      store: init.store,
      bus: init.bus,
      logger: init.logger,
      metrics: init.metrics,
      clock: init.ports.clock,
      budget: init.harnessConfig.memoryBudget,
      halfLifeMs: init.harnessConfig.memoryHalfLifeMs,
      meta: { traceId: 'runtime-memory', sessionId: init.session.id },
    });
    this.memoryPanel = {
      list: async (query) => {
        const items = await this.panelMemory.listByLayer(query?.layer, query?.sessionId);
        return items.map((item) => toMemoryView(item, this.panelMemory.describe(item)));
      },
      get: async (memoryId) => {
        const item = await this.panelMemory.get(memoryId);
        return item ? toMemoryView(item, this.panelMemory.describe(item)) : null;
      },
      forgetLog: async (limit = 200) => this.store.listForgetLog(limit),
      reactivationDue: async (limit = 3) => {
        const items = await this.panelMemory.reactivationDue(limit);
        return items.map((item) => toMemoryView(item, this.panelMemory.describe(item)));
      },
      markIncorrect: async (memoryId, reason) => {
        const item = await this.panelMemory.get(memoryId);
        if (!item) return { ok: false, error: 'memory not found' };
        await this.panelMemory.markIncorrect(memoryId, reason || 'user-correction');
        return { ok: true };
      },
      forget: async (memoryId, reason) => {
        const item = await this.panelMemory.get(memoryId);
        if (!item) return { ok: false, error: 'memory not found' };
        await this.panelMemory.forget(memoryId, reason || 'manual');
        return { ok: true };
      },
      promote: async (memoryId) => {
        const item = await this.panelMemory.get(memoryId);
        if (!item) return { ok: false, error: 'memory not found' };
        if (item.layer === 'short') await this.panelMemory.promoteMemory(memoryId);
        return { ok: true };
      },
      health: async () => {
        const [all, aggregate] = await Promise.all([
          this.panelMemory.listByLayer(),
          this.panelMemory.recallNoiseAggregate(this.session.id),
        ]);
        const byLayer: Partial<Record<MemoryLayer, number>> = {};
        for (const item of all) {
          const layer = item.layer ?? 'short';
          byLayer[layer] = (byLayer[layer] ?? 0) + 1;
        }
        return { totalMemories: all.length, byLayer, recallNoise: aggregate };
      },
      recallTimeline: async (query = {}) => this.panelMemory.recallTimeline(query),
    };

    // The chat loop (对话 mode) is runtime-scoped like the memory panel: it shares
    // the tool engine, the approval responder and the LLM chain, but never creates
    // a task, so plan machinery cannot leak into a plain conversation.
    this.chatLoop = new ChatLoop({
      workspace: init.workspace,
      ports: init.ports,
      tools: init.tools,
      bus: init.bus,
      store: init.store,
      logger: init.logger,
      metrics: init.metrics,
      config: init.harnessConfig,
      fallback: init.fallback,
      model: init.decision.model,
      responder: init.responder,
      allowedTools: init.preset?.allowedTools,
    });
  }

  static async create(options: CameliaRuntimeOptions): Promise<CameliaRuntime> {
    const workspace = path.resolve(options.workspace);
    const config: CameliaConfig = options.config ?? loadConfig();
    if (options.preferredProvider) config.preferredProvider = options.preferredProvider;

    const logger = createLogger({ level: options.logLevel ?? 'info', write: options.logTo });

    // Extension points load first: a plugin may contribute a provider (changing the
    // fallback chain) or tools, so nothing that depends on either may be built yet.
    const loader = new PluginLoader(logger);
    const plugins: PluginLoadResult = options.pluginRoot
      ? await loader.load(options.pluginRoot)
      : { tools: [], providers: [], themes: [], presets: [], rejected: [] };
    for (const rejected of plugins.rejected) {
      logger.warn('plugin rejected', {
        dir: rejected.dir,
        name: rejected.name ?? null,
        reason: rejected.reason,
        issues: rejected.issues?.map((issue) => `${issue.path}: ${issue.message}`) ?? null,
      });
    }

    const preset = resolvePreset(options, plugins, logger);

    // Live MCP connections for this runtime, closed by `close()`. Collected here
    // because `create()` builds the runtime rather than being a method on it.
    const mcpClients: McpClient[] = [];

    const pluginProviderHandles = await buildPluginProviderHandles(plugins.providers, logger);
    const handles = options.providerHandles
      ? [...options.providerHandles, ...pluginProviderHandles]
      : ProviderRegistry.fromConfig(config, pluginProviderHandles).handles();
    if (handles.length === 0) {
      throw new Error(
        'No usable model provider. Add a key to ~/.camelia/keys.json (openrouter / opencode-zen), start Ollama, or run with --mock.',
      );
    }

    // The home tree must exist before SQLite opens a file inside it, and a custom
    // `--db` path must have its parent created for the same reason.
    ensureCameliaHome();
    const databaseFile = options.databaseFile ?? paths.database();
    if (options.databaseFile && options.databaseFile !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(options.databaseFile)), { recursive: true });
    }
    // ABI-mismatch (Iteration 24, failure mode wiring): when the native binary
    // was built for a different Node ABI the store cannot open at all, so the
    // failure is recorded out-of-band (sidecar log); the next successful start
    // migrates those rows into `failure_modes` (see migrateAbiMismatch below).
    let store: SqliteSessionStore;
    try {
      store = new SqliteSessionStore(databaseFile);
    } catch (error) {
      if (isAbiMismatchError(error)) {
        appendAbiMismatch(paths.logs(), workspace, error);
      }
      throw error;
    }
    try {
      await migrateAbiMismatch(store, paths.logs(), workspace);
    } catch {
      /* best effort — a stuck sidecar must not block boot */
    }
    const tracer = new InMemoryTracer();
    const metrics = new InMemoryMetrics();
    const maxRecordedEvents = options.maxRecordedEvents ?? 2_000;
    const shared: SharedState = { events: [], persist: Promise.resolve() };

    const bus = new EventBus({
      onEmit: (event) => {
        // Logs and raw metric samples are noise for replay; they stay in the
        // tracer/metrics and on stderr, not in the durable event log.
        if (event.type === 'log' || event.type === 'metric') return;
        if (shared.events.length < maxRecordedEvents) shared.events.push(event);
        shared.persist = shared.persist
          .then(() => store.appendEvent(shared.sessionId, toStoredEvent(event)).then(() => undefined))
          .catch(() => undefined);
      },
      onSubscriberError: (error, event) => {
        logger.warn('event subscriber failed', { type: event.type, error: String(error) });
      },
    });

    const fallback = new FallbackLLMPort(handles, {
      onFallback: (from, to, reason, depth) => {
        bus.emit(
          'provider.fallback',
          { from: from.id, to: to?.id ?? '(none)', reason, depth },
          { traceId: 'provider', sessionId: shared.sessionId },
        );
      },
      onExhausted: (reason) => logger.error('all providers exhausted', { reason }),
    });

    const router = new ModelRouter(fallback, handles[0]?.models ?? [], {
      model: options.model ?? preset?.modelPreference.decision ?? config.model,
      gruntModel: options.gruntModel ?? preset?.modelPreference.grunt ?? config.gruntModel,
    });
    const decision = router.decide();
    const caps = fallback.capabilities();

    // The window we plan against is the smaller of our default and what the
    // provider advertises — over-promising the window is how context overflows.
    // plannerMode is only pinned when something actually asked for it: spreading
    // `undefined` over the default would silently disable the fast-path (the
    // runtime then runs a full self-review on every one-step task).
    const harnessConfig = resolveConfig({
      ...options.harnessConfig,
      ...(options.profileDir ? { profileDir: options.profileDir } : {}),
      ...(options.runRecordDir ? { runRecordDir: options.runRecordDir } : {}),
      ...(options.harnessConfig?.plannerMode || preset?.plannerMode
        ? { plannerMode: options.harnessConfig?.plannerMode ?? preset?.plannerMode }
        : {}),
      contextWindow: Math.min(
        options.harnessConfig?.contextWindow ?? defaultHarnessConfig.contextWindow,
        caps.maxContextWindow,
      ),
      planApproval:
        options.planApproval ??
        options.harnessConfig?.planApproval ??
        (options.autoApprove || config.planApproval === 'auto' ? 'auto' : 'always'),
    });

    const ports: HarnessPorts = {
      llm: fallback,
      fs: new NodeFs(workspace),
      shell: new NodeShell(),
      search: new NodeSearch(workspace),
      clock: systemClock,
      logger,
    };

    const tools = new ToolEngine(logger, metrics);
    tools.registerAll(options.tools ?? builtinTools);
    for (const plugin of plugins.tools) {
      for (const tool of plugin.tools) {
        // A plugin must not be able to displace a built-in (or another plugin) by a
        // name collision; skipping keeps the app bootable and the reason visible.
        if (tools.has(tool.name)) {
          logger.warn('plugin tool name already registered; skipped', {
            tool: tool.name,
            plugin: plugin.manifest.name,
          });
          continue;
        }
        tools.register(tool, { source: plugin.manifest.name });
      }
    }

    // MCP servers load last so their namespaced tools cannot collide with a
    // built-in or a plugin: `mcp.<server>.<tool>` is reserved by construction.
    // A dead server is logged and skipped — MCP extends capability, it is not a
    // dependency, so an unreachable one must not stop the app from booting.
    const mcpStatuses: McpServerStatus[] = options.mcpServers
      ? await connectAll(
          options.mcpServers,
          options.mcpTransportFactory ? { logger, createTransport: options.mcpTransportFactory } : { logger },
        ).then((result) => {
          for (const group of result.tools) {
            for (const tool of group.tools) tools.register(tool, { source: `mcp:${group.server}` });
          }
          mcpClients.push(...result.clients);
          return result.statuses;
        })
      : [];
    for (const status of mcpStatuses.filter((entry) => !entry.ok && !entry.disabled)) {
      logger.warn('MCP server unavailable', { server: status.name, error: status.error ?? null });
    }

    const session = await openWorkspaceSession(store, workspace, fallback.active.id, decision.model);

    // A previous process may have left tasks mid-flight (see `repairOrphanedTasks`).
    // Repair before the UI replays anything, or the shell will offer buttons that cannot
    // work — including in sessions this engine is not currently sitting in.
    const repaired = await repairOrphanedTasks(store);
    if (repaired > 0) {
      logger.warn('repaired tasks the previous process left mid-flight', { repaired });
    }

    const responder =
      options.approvalResponder ??
      (options.autoApprove ? autoApprover() : process.stdin.isTTY ? interactiveApprover() : denyApprover());

    return new CameliaRuntime({
      workspace,
      config,
      harnessConfig,
      session,
      store,
      bus,
      tracer,
      metrics,
      tools,
      ports,
      handles,
      fallback,
      decision,
      responder,
      testCommand: options.testCommand,
      shared,
      maxRecordedEvents,
      logger,
      preset,
      plugins,
      mcp: mcpStatuses,
      mcpClients,
    });
  }

  // ---- Chat (对话 mode): the direct conversation path ------------------------

  /**
   * One chat turn. While a task run is active the chat is refused — one
   * workspace-mutation stream at a time keeps both paths honest.
   */
  async chat(sessionId: Id, text: string, policy: ChatPolicy): Promise<void> {
    if (this.activeLoop) throw new Error('a task run is active — chat is unavailable until it finishes');
    await this.chatLoop.chat(sessionId, text, policy);
  }

  /** Answer an open `ask_user` picker from the chat path. */
  answerChat(askId: Id, optionIdx: number): boolean {
    return this.chatLoop.answer(askId, optionIdx);
  }

  /** Abort the in-flight chat turn, if any. */
  cancelChat(): void {
    this.chatLoop.cancel();
  }

  /** Run one task end to end. Never throws for task failure — inspect `outcome`. */
  async run(rawIntent: string, options: RunTaskOptions = {}): Promise<CameliaRunResult> {
    const traceId = `t-${Date.now().toString(36)}`;
    const resumeTaskId = options.resumeTaskId;
    const sessionId = options.sessionId ?? this.session.id;

    let task: Task;
    let plan = options.plan;
    if (resumeTaskId) {
      const persisted = await this.store.getTask(resumeTaskId);
      if (!persisted) throw new Error(`cannot resume: task ${resumeTaskId} was not found`);
      task = persisted;
      if (!rawIntent) rawIntent = persisted.intentRaw;
      // The step table is authoritative for status; `tasks.plan_json` is written at
      // plan time and does not track the per-step updates, so overlay the two. This
      // is what lets a resumed run skip finished steps instead of redoing them.
      if (persisted.plan) {
        const persistedSteps = new Map((await this.store.listSteps(persisted.id)).map((s) => [s.id, s]));
        plan = { ...persisted.plan, steps: persisted.plan.steps.map((s) => persistedSteps.get(s.id) ?? s) };
      }
    } else {
      task = await this.store.createTask({
        sessionId,
        intentRaw: rawIntent,
        workspace: this.workspace,
      });
      const title = rawIntent.trim().split('\n')[0]?.slice(0, 72);
      if (title) await this.store.updateSession(sessionId, { title });
    }

    const meta = { traceId, sessionId, taskId: task.id };
    if (resumeTaskId) this.bus.emit('task.resumed', { fromStatus: task.status }, meta);
    else this.bus.emit('task.received', { task }, meta);

    this.controller = new AbortController();
    const journal = new WorkspaceJournal(paths.backups(), task.id, this.ports.fs, this.logger);

    const ctx: RunContext = {
      taskId: task.id,
      sessionId,
      workspace: this.workspace,
      traceId,
      model: this.decision.model,
      gruntModel: this.decision.gruntModel,
      ports: this.ports,
      infra: {
        bus: this.bus,
        store: this.store,
        tracer: this.tracer,
        metrics: this.metrics,
        logger: this.logger,
      },
      config: this.harnessConfig,
      allowedTools: this.preset?.allowedTools,
      presetDirectives: this.preset?.systemPrompt,
      signal: this.controller.signal,
    };

    const gateway = new ModelGateway(ctx);
    const context = new ContextManager(this.harnessConfig, emptySlots(), undefined, this.logger, this.metrics);
    const approval = new ApprovalGate(this.harnessConfig.approval, this.responder, this.logger, this.metrics);
    const loopDetector = new LoopDetector(this.harnessConfig.loopRepeatThreshold);
    const drift = new DriftDetector(this.harnessConfig.driftThreshold);
    const recovery = new ErrorRecovery(this.harnessConfig.maxRetries);
    // The planner sees the real tool names so it cannot plan a step no tool can
    // perform (measured: a weak model planned "Create directory 'src'" for a task
    // that only needed a file written).
    const planner = new Planner(
      gateway,
      ctx,
      this.tools.schemas(ctx.allowedTools).map((schema) => schema.name),
    );
    const clarifier = new Clarifier(gateway, ctx);
    const executor = new Executor(
      { gateway, tools: this.tools, approval, context, journal, loop: loopDetector, config: this.harnessConfig },
      ctx,
    );
    const verifier = new Verifier(ctx, { defaultTestCommand: this.testCommand, approval });

    // The orchestrator needs the loop, and the loop needs the orchestrator: a
    // late-bound holder keeps the dependency acyclic without a service locator.
    const loopHolder: { current?: AgentLoop } = {};
    const subAgents = new SubAgentOrchestrator(
      (spec, signal) => {
        if (!loopHolder.current) throw new Error('sub-agent requested before the agent loop was ready');
        return loopHolder.current.runSubAgent(spec, signal);
      },
      ctx,
      this.harnessConfig,
    );
    const agentLoop = new AgentLoop(
      {
        gateway,
        planner,
        executor,
        verifier,
        recovery,
        context,
        journal,
        loop: loopDetector,
        drift,
        subAgents,
        config: this.harnessConfig,
        planGate: this.planGate,
        selfReview: new PlanSelfReview(),
        memory: new MemoryService({
          store: this.store,
          bus: this.bus,
          logger: this.logger,
          metrics: this.metrics,
          clock: this.ports.clock,
          budget: this.harnessConfig.memoryBudget,
          halfLifeMs: this.harnessConfig.memoryHalfLifeMs,
          meta,
        }),
      },
      ctx,
    );
    loopHolder.current = agentLoop;
    this.activeLoop = agentLoop;

    this.bus.emit(
      'provider.selected',
      { providerId: this.fallback.active.id, model: this.decision.model, reason: this.decision.reason },
      meta,
    );

    // On resume the persisted intent is reused when available; otherwise the
    // deterministic (offline) restatement avoids a redundant model call.
    const persistedIntent = resumeTaskId ? task.intentClarified : undefined;
    const intent =
      persistedIntent ?? (await clarifier.clarify(rawIntent, { offline: options.offlineClarify || Boolean(resumeTaskId) }));
    await this.store.updateTask(task.id, { intentClarified: intent });
    this.bus.emit('task.clarified', { intent }, meta);

    const outcome = await agentLoop.run(intent, { plan, startStepIdx: options.startStepIdx });
    this.activeLoop = undefined;
    await this.flush();

    return {
      outcome,
      intent,
      session: this.session,
      task,
      provider: {
        id: this.fallback.active.id,
        label: this.handles.find((h) => h.id === this.fallback.active.id)?.label ?? this.fallback.active.id,
        model: this.decision.model,
        gruntModel: this.decision.gruntModel,
        chain: this.fallback.chain,
        depth: this.fallback.depth,
      },
      context: context.snapshot(),
      budget: context.budget(),
      metrics: this.metrics.snapshot(),
      events: [...this.shared.events],
      trace: this.tracer.spans(),
      preset: this.preset
        ? { id: this.preset.id, label: this.preset.label, allowedTools: this.preset.allowedTools }
        : undefined,
    };
  }

  /** Approve the plan that is waiting. `session` skips later plans in this process. */
  approvePlan(taskId: string, scope: 'once' | 'session'): boolean {
    return this.planGate.settle(taskId, { action: 'approve', scope });
  }

  rejectPlan(taskId: string, reason: string): boolean {
    return this.planGate.settle(taskId, { action: 'reject', reason });
  }

  editPlan(taskId: string, edits: PlanEdit[]): boolean {
    return this.planGate.settle(taskId, { action: 'edit', edits });
  }

  setPlanApproval(mode: 'always' | 'auto'): void {
    this.harnessConfig.planApproval = mode;
  }

/**
 * The task currently being executed in this process, or `undefined` when idle.
 *
 * Public because `pause` / `cancel` now refuse a task id that is not the running one,
 * and their natural callers — the tests that drive those two from inside a tool call,
 * and any surface that wants to say which run a button belongs to — need to name it.
 */
get activeTaskId(): string | undefined {
  return this.activeLoop?.currentTaskId;
}

/**
 * Ask the running task to pause at the next safe boundary.
 *
 * `taskId` is checked against the loop that is actually running, and the command is
 * refused when they disagree. The session rail lets the user switch to a different
 * session while a run is in flight, so a pause aimed at the task on screen would
 * otherwise stop a task the user cannot even see — the last write wins is not a
 * defensible reading of "stop this".
 */
pause(taskId: string, reason = 'user requested'): boolean {
  if (!this.activeLoop) return false;
  if (this.activeLoop.currentTaskId !== taskId) return false;
  this.activeLoop.pause(reason);
  return true;
}

/**
 * Cancel the running task. The loop unwinds and reports `cancelled`.
 *
 * Same task-id guard as {@link pause}. The abort fires first, before the guard, exactly
 * as before: a cancel means "nothing further from this process runs", which has to hold
 * even for a task the user has navigated away from.
 */
cancel(taskId: string, reason = 'cancelled'): boolean {
  this.controller.abort();
  if (!this.activeLoop) return false;
  if (this.activeLoop.currentTaskId !== taskId) return false;
  this.activeLoop.cancel(reason);
  return true;
}

  /** Change the goal of the running task (metric M7). */
  intervene(instruction: string): boolean {
    if (!this.activeLoop) return false;
    this.activeLoop.intervene(instruction);
    return true;
  }

  /**
   * User-initiated rollback to a checkpoint. The loop emits
   * `recovery.rollback_started` / `recovery.rollback_done`; the journal restores
   * the pre-task file state. Returns false when no task is running.
   */
  async rollback(checkpointId: string): Promise<boolean> {
    if (!this.activeLoop) return false;
    await this.activeLoop.rollback(checkpointId);
    return true;
  }

  /**
   * User-initiated mid-session provider switch. Moves the fallback cursor to the
   * requested provider and emits `provider.selected`. Returns false when the
   * provider id is not in the chain.
   */
  selectProvider(providerId: string, model?: string): boolean {
    if (!this.fallback.switchTo(providerId)) return false;
    if (model) this.decision.model = model;
    this.bus.emit(
      'provider.selected',
      { providerId: this.fallback.active.id, model: model ?? this.decision.model, reason: 'user-selected' },
      { traceId: 'user-action', sessionId: this.session.id, taskId: this.activeLoop?.currentTaskId },
    );
    this.persistSelectedProvider(this.fallback.active.id, model ?? this.decision.model);
    return true;
  }

  /** Best-effort persistence of the user's provider choice across restarts. */
  private persistSelectedProvider(providerId: string, model: string): void {
    try {
      const configPath = paths.config();
      const raw = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '{}';
      const cfg = JSON.parse(raw) as Record<string, unknown>;
      cfg.lastSelectedProvider = { providerId, model, at: new Date().toISOString() };
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    } catch {
      // best effort — never throw into user action
    }
  }

  /** Wait until every emitted event has been written to SQLite. */
  async flush(): Promise<void> {
    // The chain may be extended while we await, so loop until it settles.
    let seen: Promise<void>;
    do {
      seen = this.shared.persist;
      await seen;
    } while (seen !== this.shared.persist);
  }

  /** The provider chain, in fallback order. */
  providerChain(): { id: string; label: string; model: string; models: string[]; active: boolean }[] {
    const activeId = this.fallback.active.id;
    return this.handles.map((handle) => ({
      id: handle.id,
      label: handle.label,
      model: handle.model,
      models: handle.models,
      active: handle.id === activeId,
    }));
  }

  /**
   * Open a blank session of `kind` — reusing an unused blank when one already
   * exists so 「新建」 cannot pile empty rows in the session rail.
   *
   * Blank means: same kind, zero tasks, zero events. A session that once had
   * chat or a task is never reused here; the user asked for a clean slate, and
   * that only applies to rows that never held work.
   */
  async newSession(kind: 'work' | 'math' = 'work'): Promise<{ sessionId: string }> {
    const recent = await this.store.listSessions();
    for (const candidate of recent) {
      if ((candidate.kind ?? 'work') !== kind) continue;
      const tasks = await this.store.listTasks(candidate.id);
      if (tasks.length > 0) continue;
      const events = await this.store.listEvents({ sessionId: candidate.id, limit: 1 });
      if (events.length > 0) continue;
      this.session = candidate;
      return { sessionId: candidate.id };
    }
    const created = await this.store.createSession({
      title: '新会话',
      workspace: this.session.workspace,
      provider: this.fallback.active.id,
      model: this.decision.model,
      kind,
    });
    // Hot-switch the runtime's active session so subsequent events attribute correctly.
    this.session = created;
    return { sessionId: created.id };
  }

  /** Switch the runtime's active session to an existing row. Returns false if not found. */
  async selectSession(sessionId: string): Promise<boolean> {
    const existing = await this.store.getSession(sessionId).catch(() => undefined);
    if (!existing) return false;
    this.session = existing;
    return true;
  }

  get routingReason(): string {
    return this.decision.reason;
  }

  get modelInfo(): { model: string; gruntModel: string } {
    return { model: this.decision.model, gruntModel: this.decision.gruntModel };
  }

  get maxEvents(): number {
    return this.maxRecordedEvents;
  }

  /** Read back the durable event log for a task — the replay/audit path. */
  async replay(taskId: Id): Promise<StoredEvent[]> {
    return this.store.listEvents({ taskId, limit: 5_000 });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Close MCP connections before the store: a stdio server is a child process,
    // and leaking one per run would accumulate across a long session.
    await disconnectAll(this.mcpClients);
    await this.flush();
    this.store.close();
  }
}

function toStoredEvent(event: DomainEvent): StoredEvent {
  return {
    type: event.type,
    payload: event.payload,
    traceId: event.traceId,
    sessionId: event.sessionId,
    taskId: event.taskId,
    ts: event.ts,
    seq: 0,
  };
}

/**
 * Resolve the requested preset from built-ins, plugin-supplied presets and the
 * user's preset directory.
 *
 * An unknown id is an error, not a silent fallback: a user who typed
 * `--preset reviewer` and got `coder` would believe a read-only guarantee that
 * was never in effect.
 */
function resolvePreset(
  options: CameliaRuntimeOptions,
  plugins: PluginLoadResult,
  logger: LoggerPort,
): AgentPreset | undefined {
  if (!options.preset) return undefined;
  const { registry, issues } = PresetRegistry.fromSources({
    fromPlugins: plugins.presets.map((plugin) => plugin.preset),
    userDir: options.presetDir ?? paths.presets(),
  });
  for (const issue of issues) {
    logger.warn('preset file rejected', {
      file: issue.file,
      issues: issue.issues.map((entry) => `${entry.path}: ${entry.message}`),
    });
  }
  const preset = registry.get(options.preset);
  if (!preset) {
    throw new Error(`unknown agent preset "${options.preset}". Available: ${registry.ids().join(', ')}`);
  }
  return preset;
}

/**
 * Turn provider plugins into fallback-chain handles.
 *
 * A plugin whose `createPort()` or `listModels()` throws is dropped with a warning
 * rather than failing the run — a broken plugin must not make Camelia unusable.
 */
async function buildPluginProviderHandles(
  providers: LoadedProviderPlugin[],
  logger: LoggerPort,
): Promise<ProviderHandle[]> {
  const handles: ProviderHandle[] = [];
  for (const plugin of providers) {
    try {
      const port = plugin.createPort();
      const models = await port.listModels();
      handles.push({
        id: plugin.manifest.name,
        label: plugin.manifest.name,
        model: models[0]?.id ?? '',
        models: models.map((model) => model.id),
        port,
      });
    } catch (error) {
      logger.warn('provider plugin failed to initialise', {
        plugin: plugin.manifest.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return handles;
}