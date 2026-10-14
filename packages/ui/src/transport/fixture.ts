/**
 * Fixture transport — a tiny, deterministic stand-in for a live engine.
 *
 * It exists for three jobs: offline demos, reproducible screenshots, and UI tests that
 * need a real event stream without a model or a database. It is *not* a second engine:
 * it replays a scripted event list and reacts to user commands with the same domain
 * events the real `harness` would emit, so the UI code path is identical in both modes.
 * @module
 */

import type {
  Command,
  DomainEvent,
  DomainEventMap,
  DomainEventType,
  JsonValue,
  Task,
  ToolCall,
} from '@camelia/core';

import { initialSnapshot, reduceEvents, type ProjectionSnapshot, type SessionView } from '@camelia/agent/view';

import {
  BOOTSTRAP_PROVIDER,
  BOOTSTRAP_PROVIDER_STATUS,
  PRIMARY_SESSION,
  SESSION_LIST,
  buildScenario,
  sceneStatus,
  type SceneId,
} from './scenario.js';
import { createFixtureMemoryDb, type FixtureMemoryDb } from './fixture-memory.js';
import type { BootstrapPayload, ConnectionStatus, Transport, TransportHandlers } from './types.js';

export interface FixtureOptions {
  scene?: SceneId;
  /**
   * `instant` (default) replays the whole script synchronously — what screenshots and
   * tests want. `timed` honours the script's own timestamps so the demo animates.
   */
  replay?: 'instant' | 'timed';
}

export class FixtureTransport implements Transport {
  readonly kind = 'fixture' as const;
  readonly sent: Command[] = [];

  private handlers?: TransportHandlers;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private clock = 0;
  private snapshot: ProjectionSnapshot = initialSnapshot();
  /** Per-session event tape, so leaving a session and coming back restores it. */
  private tapes = new Map<string, DomainEvent[]>();
  private sessionRows: SessionView[] = [];
  private activeSessionId?: string;
  /** False while a tape is replayed, so the replay is not appended to itself. */
  private record = true;
  /** Scripted memory panel data (Iteration 22) — a stand-in, never the engine. */
  private memory: FixtureMemoryDb = createFixtureMemoryDb(Date.now(), PRIMARY_SESSION.id);
  /** On-disk plugins the fixture pretends are under `~/.camelia/plugins`. */
  private installedPlugins: FixturePlugin[] = [];
  /** Skill folders `list_skills` returns. Catalog installs append here. */
  private skillRows: FixtureSkill[] = [
    {
      id: 'user:demo-skill',
      name: 'demo-skill',
      description: 'A fixture skill',
      dir: '/skills/demo-skill',
      source: 'user',
    },
  ];

  constructor(private readonly options: FixtureOptions = {}) {}

  get scene(): SceneId {
    return this.options.scene ?? 'running';
  }

  start(handlers: TransportHandlers): void {
    this.handlers = handlers;
    // The `error` scene exists so the transport-failure UI is reproducible in a screenshot
    // and a test: the engine refuses to start, and the store turns that into the error state.
    if (this.scene === 'error') {
      throw new Error('engine unreachable — ECONNREFUSED 127.0.0.1:7433 after all three free paths failed');
    }
    handlers.onStatus('connecting');
    const bare = this.scene === 'empty' || this.scene === 'connecting';
    this.sessionRows = bare ? [] : SESSION_LIST.map((row) => ({ ...row }));
    this.activeSessionId = bare ? undefined : PRIMARY_SESSION.id;
    handlers.onBootstrap(this.bootstrap());

    const events = buildScenario(this.scene);
    const first = events[0];
    this.clock = first ? first.ts : 0;

    if (this.options.replay === 'timed' && first) {
      const t0 = first.ts;
      for (const event of events) {
        const delay = Math.max(0, event.ts - t0);
        this.timers.push(setTimeout(() => this.emit(event), delay));
      }
      this.timers.push(setTimeout(() => handlers.onStatus(sceneStatus(this.scene)), (events.at(-1)?.ts ?? t0) - t0 + 10));
      return;
    }

    for (const event of events) this.emit(event);
    handlers.onStatus(sceneStatus(this.scene));
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  send(command: Command): void {
    this.sent.push(command);
    if (!this.handlers) return;
    this.react(command);
  }

  private bootstrap(): BootstrapPayload {
    const bare = this.scene === 'empty' || this.scene === 'error' || this.scene === 'connecting';
    return {
      session: bare ? undefined : PRIMARY_SESSION,
      sessions: bare ? [] : SESSION_LIST,
      provider: bare ? undefined : BOOTSTRAP_PROVIDER,
      providerStatus: bare ? undefined : BOOTSTRAP_PROVIDER_STATUS,
    };
  }

  private emit(event: DomainEvent): void {
    this.snapshot = reduceEvents(this.snapshot, [event]);
    if (this.record && this.activeSessionId) {
      const tape = this.tapes.get(this.activeSessionId) ?? [];
      tape.push(event);
      this.tapes.set(this.activeSessionId, tape);
    }
    this.handlers?.onEvent(event);
  }

  private replaySession(sessionId: string): void {
    const tape = this.tapes.get(sessionId);
    if (!tape || sessionId === this.activeSessionId) return;
    const row = this.sessionRows.find((session) => session.id === sessionId);
    if (!row || !this.handlers) return;
    this.activeSessionId = sessionId;
    this.record = false;
    this.snapshot = initialSnapshot();
    this.handlers.onBootstrap({
      session: row,
      sessions: this.sessionRows,
      provider: BOOTSTRAP_PROVIDER,
      providerStatus: BOOTSTRAP_PROVIDER_STATUS,
    });
    for (const event of tape) {
      this.snapshot = reduceEvents(this.snapshot, [event]);
      this.handlers.onEvent(event);
    }
    this.record = true;
  }

  /** Push an event onto the tail of the replay clock. */
  private push<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.clock += 5;
    this.emit({ type, payload, traceId: 'trc_fixture', ts: this.clock } as DomainEvent);
  }

  private status(status: ConnectionStatus): void {
    this.handlers?.onStatus(status);
  }

  /** Answer a query command through the same `onCommandResult` channel a live engine uses. */
  private answer(commandId: string, data: unknown): void {
    this.handlers?.onCommandResult?.(commandId, data);
  }

  private react(command: Command): void {
    const task = this.snapshot.task;
    switch (command.type) {
      // ---- memory panel (Iteration 22) -----------------------------------
      case 'list_memories':
        this.answer(
          command.commandId,
          this.memory.list(command.payload.layer, command.payload.sessionId, command.payload.curated === true),
        );
        return;
      case 'get_memory':
        this.answer(command.commandId, this.memory.get(command.payload.memoryId));
        return;
      case 'list_forget_log':
        this.answer(command.commandId, this.memory.forgetLogEntries(command.payload.limit ?? 200));
        return;
      case 'list_reactivation_due':
        this.answer(command.commandId, this.memory.reactivationDue(command.payload.limit ?? 3));
        return;
      case 'mark_memory_incorrect': {
        const item = this.memory.markIncorrect(command.payload.memoryId);
        this.answer(command.commandId, { ok: true });
        if (!item) return;
        this.push('memory.downgraded', {
          memoryId: item.id,
          reason: command.payload.reason ?? 'user-correction',
          correctness: 0,
        });
        return;
      }
      case 'forget_memory': {
        const item = this.memory.forget(command.payload.memoryId, command.payload.reason ?? 'manual');
        this.answer(command.commandId, { ok: true });
        if (!item) return;
        this.push('memory.forgotten', {
          memoryId: item.id,
          contentSnippet: item.content.slice(0, 120),
          reason: command.payload.reason ?? 'manual',
          value: item.strength,
        });
        return;
      }
      case 'promote_memory': {
        const item = this.memory.promote(command.payload.memoryId);
        this.answer(command.commandId, { ok: true });
        if (!item) return;
        this.push('memory.promoted', { memoryId: item.id, layer: 'long', reason: 'user-promotion' });
        return;
      }
      case 'get_memory_health': {
        const items = this.memory.items;
        const byLayer: Partial<Record<string, number>> = {};
        for (const item of items) byLayer[item.layer ?? 'short'] = (byLayer[item.layer ?? 'short'] ?? 0) + 1;
        this.answer(command.commandId, {
          totalMemories: items.length,
          byLayer,
          recallNoise: { totalHits: 13, downgradedHits: 1, noiseRate: 1 / 13, downgradedMemories: 1 },
        });
        return;
      }
      case 'approve_tool': {
        const call = task?.toolCalls[command.payload.callId];
        if (!call) return;
        this.push('tool.approved', { callId: call.id, by: 'user' });
        this.push('tool.started', { callId: call.id, name: call.name });
        this.clock += 5;
        const finished: ToolCall = {
          id: call.id,
          stepId: call.stepId,
          taskId: call.taskId,
          name: call.name,
          input: call.input,
          output: fixtureOutput(call),
          status: 'ok',
          risk: call.risk,
          reversible: call.reversible,
          durationMs: 412,
          traceId: 'trc_fixture',
          createdAt: this.clock,
        };
        this.push('tool.finished', { call: finished });
        this.status('live');
        return;
      }
      case 'deny_tool':
        this.push('tool.denied', { callId: command.payload.callId, reason: command.payload.reason });
        return;
      case 'approve_plan':
        this.push('task.status_changed', {
          from: 'awaiting-approval',
          to: 'executing',
          reason: command.payload.scope === 'session' ? 'plan approved for session' : 'plan approved once',
        });
        this.push('task.phase_changed', { phase: 'executing' });
        return;
      case 'reject_plan':
        this.push('task.status_changed', { from: 'awaiting-approval', to: 'cancelled', reason: command.payload.reason });
        this.push('task.phase_changed', { phase: 'idle' });
        return;
      case 'edit_plan':
        this.answer(command.commandId, { ok: true, edits: command.payload.edits.length });
        return;
      case 'set_plan_approval':
        this.answer(command.commandId, { ok: true, mode: command.payload.mode });
        return;
      case 'pause_task':
        this.push('task.paused', { reason: command.payload.reason });
        return;
      case 'resume_task':
        this.push('task.resumed', { fromStatus: 'paused' });
        return;
      case 'cancel_task':
        this.push('task.cancelled', { reason: command.payload.reason });
        return;
      case 'intervene_goal':
        this.push('task.intervened', {
          instruction: command.payload.instruction,
          previousGoal: task?.goal ?? task?.intentRaw ?? '',
          newGoal: command.payload.instruction,
        });
        return;
      case 'rollback_step': {
        const restored = task?.steps.filter((s) => s.status === 'done').length ?? 0;
        this.push('recovery.rollback_started', { checkpointId: command.payload.checkpointId });
        this.push('recovery.rollback_done', { checkpointId: command.payload.checkpointId, restored });
        return;
      }
      case 'new_session': {
        // One blank at a time: reuse a stable id per kind so tests and the rail
        // do not accumulate empty rows when 「新建」 is clicked repeatedly.
        // Deleting that blank passes excludeId so the same row is not handed back.
        const rawKind = command.payload?.kind;
        const kind: 'work' | 'math' | 'term' =
          rawKind === 'math' ? 'math' : rawKind === 'term' ? 'term' : 'work';
        const excludeId = command.payload?.excludeId;
        let sessionId =
          kind === 'math' ? 'ses_blank_math' : kind === 'term' ? 'ses_blank_term' : 'ses_blank_work';
        if (excludeId && sessionId === excludeId) sessionId = `${sessionId}_next`;
        const blank = {
          id: sessionId,
          title: '新会话',
          workspace: PRIMARY_SESSION.workspace,
          provider: PRIMARY_SESSION.provider,
          model: PRIMARY_SESSION.model,
          kind,
          blank: true,
        };
        // The previous session keeps the events already recorded on its tape.
        this.activeSessionId = sessionId;
        this.tapes.set(sessionId, []);
        this.sessionRows = [blank, ...this.sessionRows.filter((row) => row.id !== sessionId)];
        // Drop the previous task/chat so the shell shows the centred empty state.
        this.snapshot = initialSnapshot();
        this.handlers?.onBootstrap({
          session: blank,
          sessions: this.sessionRows,
          provider: BOOTSTRAP_PROVIDER,
          providerStatus: BOOTSTRAP_PROVIDER_STATUS,
        });
        this.answer(command.commandId, { sessionId });
        return;
      }
      case 'select_session':
        this.answer(command.commandId, { ok: true });
        this.replaySession(command.payload.sessionId);
        return;
      case 'rename_session': {
        const sessionId = command.payload.sessionId;
        const title = command.payload.title.trim().slice(0, 120);
        if (!title) {
          this.answer(command.commandId, { ok: false, error: '标题不能为空' });
          return;
        }
        this.sessionRows = this.sessionRows.map((row) => (row.id === sessionId ? { ...row, title } : row));
        if (this.snapshot.session?.id === sessionId) {
          this.snapshot = { ...this.snapshot, session: { ...this.snapshot.session, title } };
        }
        const current = this.sessionRows.find((row) => row.id === sessionId) ?? this.snapshot.session;
        if (current) {
          this.handlers?.onBootstrap({
            session: current,
            sessions: this.sessionRows.length ? this.sessionRows : [current],
            provider: BOOTSTRAP_PROVIDER,
            providerStatus: BOOTSTRAP_PROVIDER_STATUS,
          });
        }
        this.answer(command.commandId, { sessionId, title });
        return;
      }
      case 'delete_session': {
        const sessionId = command.payload.sessionId;
        this.sessionRows = this.sessionRows.filter((row) => row.id !== sessionId);
        this.tapes.delete(sessionId);
        this.answer(command.commandId, { sessionId });
        return;
      }
      case 'list_skills':
        this.answer(command.commandId, this.skillRows);
        return;
      case 'install_skill': {
        const source = typeof command.payload?.path === 'string' ? command.payload.path.trim() : '';
        if (!source) {
          this.answer(command.commandId, { ok: false, error: '路径不能为空' });
          return;
        }
        const name = source.split(/[/\\]/).filter(Boolean).pop() || 'skill';
        const row = { id: `user:${name}`, name, description: 'Installed', dir: source, source: 'user' };
        this.skillRows = [...this.skillRows.filter((skill) => skill.name !== name), row];
        this.answer(command.commandId, [row]);
        return;
      }
      case 'list_plugins':
        this.answer(command.commandId, this.installedPlugins);
        return;
      case 'fetch_extension_catalog':
        this.answer(command.commandId, FIXTURE_CATALOG);
        return;
      case 'install_catalog_plugin': {
        const id = command.payload.id.trim();
        const known = FIXTURE_CATALOG.plugins.find((entry) => entry.id === id);
        if (!known) {
          this.answer(command.commandId, { ok: false, error: '目录里没有这个插件' });
          return;
        }
        const row = {
          id,
          name: known.name,
          description: known.description,
          kind: 'theme',
          dir: `/plugins/${id}`,
        };
        this.installedPlugins = [...this.installedPlugins.filter((plugin) => plugin.id !== id), row];
        this.answer(command.commandId, { id, dir: row.dir, restartRequired: true });
        return;
      }
      case 'install_catalog_skill': {
        const id = command.payload.id.trim();
        const known = FIXTURE_CATALOG.skills.find((entry) => entry.id === id);
        if (!known) {
          this.answer(command.commandId, { ok: false, error: '目录里没有这个技能' });
          return;
        }
        const row = {
          id: `user:${id}`,
          name: known.name,
          description: known.description,
          dir: `/skills/${id}`,
          source: 'user',
        };
        this.skillRows = [...this.skillRows.filter((skill) => skill.name !== known.name), row];
        this.answer(command.commandId, [row]);
        return;
      }
      case 'set_workspace': {
        const dir = typeof command.payload?.path === 'string' ? command.payload.path.trim() : '';
        // Bootstrap writes the session into the store. The fixture snapshot only
        // folds domain events, so the row lives on `sessionRows`.
        const current =
          this.sessionRows.find((row) => row.id === this.activeSessionId) ?? this.snapshot.session;
        if (!dir || !current) {
          this.answer(command.commandId, { ok: false, error: 'not a directory' });
          return;
        }
        const next = { ...current, workspace: dir };
        this.sessionRows = this.sessionRows.map((row) => (row.id === next.id ? { ...row, workspace: dir } : row));
        this.handlers?.onBootstrap({
          session: next,
          sessions: this.sessionRows.length ? this.sessionRows : [next],
          provider: BOOTSTRAP_PROVIDER,
          providerStatus: BOOTSTRAP_PROVIDER_STATUS,
        });
        this.snapshot = { ...this.snapshot, session: next };
        this.answer(command.commandId, { ok: true, workspace: dir });
        return;
      }
      case 'select_provider':
        this.push('provider.selected', {
          providerId: command.payload.providerId,
          model: command.payload.model ?? 'default',
          reason: 'user selection',
        });
        return;
      case 'apply_provider':
        this.push('provider.selected', {
          providerId: command.payload.providerId ?? BOOTSTRAP_PROVIDER.activeProvider,
          model: command.payload.model ?? BOOTSTRAP_PROVIDER.activeModel,
          reason: 'config-reloaded',
        });
        this.answer(command.commandId, {
          ok: true,
          providerId: command.payload.providerId,
          model: command.payload.model,
        });
        return;
      // ---- chat (对话 mode): the same chat.* events a live engine emits -----
      case 'chat_message': {
        const turnId = `turn_${(this.sent.length * 6151 + 2749).toString(16)}`;
        const answer =
          '这是对话模式的直答回复（offline fixture）。真实引擎在这里流式输出模型回复，并按所选权限策略使用工具。';
        const folders = command.payload.folders ?? [];
        const folderNote = folders.length
          ? `\n\nAttached folders:\n${folders.map((folder) => `- ${folder.name}${folder.path ? ` (${folder.path})` : ''}`).join('\n')}`
          : '';
        const text = `${command.payload.text}${folderNote}`;
        this.push('chat.received', { turnId, text, ...(command.payload.images?.length ? { images: command.payload.images } : {}) });
        this.push('chat.delta', { turnId, delta: answer.slice(0, 18) });
        this.push('chat.delta', { turnId, delta: answer.slice(18) });
        this.push('chat.message', { turnId, role: 'assistant', text: answer });
        return;
      }
      case 'chat_answer':
        this.push('chat.answered', { askId: command.payload.askId, optionIdx: command.payload.optionIdx });
        return;
      case 'chat_cancel':
        return;
      case 'set_work_posture':
        this.push('work.mode_set', { posture: command.payload.posture });
        return;
      case 'save_work_plan': {
        const id = `wpl_${(this.sent.length * 7919).toString(16)}`;
        this.push('work.plan_saved', {
          id,
          sessionId: command.payload.sessionId,
          mode: command.payload.mode,
          title: command.payload.title,
          goal: command.payload.goal,
          constraints: command.payload.constraints,
          body: command.payload.body,
        });
        return;
      }
      case 'list_predictions':
        // No predictions in the fixture. An empty list is the honest empty state.
        this.answer(command.commandId, []);
        return;
      case 'explain_prediction':
        this.answer(command.commandId, null);
        return;
      case 'get_competence':
        this.answer(command.commandId, []);
        return;
      case 'set_cognition_mode':
        this.answer(command.commandId, { mode: command.payload.mode });
        return;
      case 'submit_term': {
        // Same events a live team run folds: plan, a worker, verify, then done.
        // Done is only honest here because the worker report is `ok`.
        this.clock += 5;
        const taskId = `tsk_term_${(this.sent.length * 7919 + 104729).toString(16)}`;
        const now = this.clock;
        const task: Task = {
          id: taskId,
          sessionId: command.payload.sessionId,
          intentRaw: command.payload.intent,
          status: 'planning',
          phase: 'planning',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        };
        this.push('task.received', { task });
        this.push('task.status_changed', { from: 'received', to: 'planning', reason: 'coordinator' });
        this.push('task.phase_changed', { phase: 'planning' });
        this.push('task.status_changed', { from: 'planning', to: 'executing', reason: 'workers assigned' });
        this.push('task.phase_changed', { phase: 'executing' });
        this.push('subagent.spawned', {
          id: 'wrk_term_1',
          goal: command.payload.intent,
          parentTaskId: taskId,
          model: 'qwen-vl-plus',
          role: 'worker',
        });
        this.push('subagent.finished', {
          report: {
            id: 'wrk_term_1',
            parentTaskId: taskId,
            goal: command.payload.intent,
            status: 'ok',
            summary: 'worker finished',
            artifacts: [],
            verdicts: [],
            tokensUsed: 12,
            startedAt: now,
            endedAt: now + 1,
          },
        });
        this.push('task.status_changed', { from: 'executing', to: 'verifying', reason: 'check reports' });
        this.push('task.phase_changed', { phase: 'verifying' });
        this.push('task.completed', { summary: 'worker finished', artifacts: [] });
        return;
      }
      case 'submit_task': {
        // Offline fixture: do not replay the canned CLI demo for a typed intent.
        this.clock += 5;
        const taskId = `tsk_${(this.sent.length * 7919 + 104729).toString(16)}`;
        const now = this.clock;
        const task: Task = {
          id: taskId,
          sessionId: command.payload.sessionId,
          intentRaw: command.payload.intent,
          status: 'received',
          phase: 'idle',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        };
        this.push('task.received', { task });
        this.push('task.failed', {
          reason: '未连接引擎 — offline fixture cannot run a live model',
          recoverable: false,
        });
        this.status('offline');
        this.answer(command.commandId, { ok: false, error: 'engine unreachable' });
        return;
      }
    }
  }
}

interface FixturePlugin {
  id: string;
  name: string;
  description: string;
  kind: string;
  dir: string;
}

interface FixtureSkill {
  id: string;
  name: string;
  description: string;
  dir: string;
  source: string;
}

const FIXTURE_CATALOG = {
  version: 1 as const,
  sourceUrl: 'https://raw.githubusercontent.com/CameliaDev/camelia-extensions/main/catalog.json',
  plugins: [
    {
      id: 'quiet-activity-bar',
      name: 'Quiet activity bar',
      description: 'Quieter ink tokens',
      repo: 'https://github.com/CameliaDev/camelia-extensions',
      path: 'plugins/quiet-activity-bar',
      tags: ['theme'],
    },
  ],
  skills: [
    {
      id: 'catalog-maintainer',
      name: 'Catalog maintainer',
      description: 'Add an entry to the Camelia catalog',
      repo: 'https://github.com/CameliaDev/camelia-extensions',
      path: 'skills/catalog-maintainer',
      tags: ['meta'],
    },
    {
      id: 'quiet-shell-notes',
      name: 'Quiet shell notes',
      description: 'Notes for the quieter shell',
      repo: 'https://github.com/CameliaDev/camelia-extensions',
      path: 'skills/quiet-shell-notes',
      tags: ['shell'],
    },
  ],
};

/** Canned but plausible tool output for a command-driven approval. */
function fixtureOutput(call: Pick<ToolCall, 'name' | 'input'>): JsonValue {
  if (call.name === 'shell.run') {
    const cmd = (call.input as { cmd?: string } | null)?.cmd ?? 'command';
    return { exitCode: 0, cmd, stdout: 'ok', durationMs: 412 };
  }
  if (call.name === 'fs.read') return { lines: 42, bytes: 1180 };
  return { ok: true };
}