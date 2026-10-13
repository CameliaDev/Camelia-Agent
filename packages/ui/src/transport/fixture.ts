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

import { initialSnapshot, reduceEvents, type ProjectionSnapshot } from '@camelia/agent/view';

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
  /** Scripted memory panel data (Iteration 22) — a stand-in, never the engine. */
  private memory: FixtureMemoryDb = createFixtureMemoryDb(Date.now(), PRIMARY_SESSION.id);

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
    this.handlers?.onEvent(event);
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
        this.answer(command.commandId, this.memory.list(command.payload.layer, command.payload.sessionId));
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
        const kind = command.payload?.kind === 'math' ? 'math' : 'work';
        const sessionId = kind === 'math' ? 'ses_blank_math' : 'ses_blank_work';
        const blank = {
          id: sessionId,
          title: '新会话',
          workspace: PRIMARY_SESSION.workspace,
          provider: PRIMARY_SESSION.provider,
          model: PRIMARY_SESSION.model,
          kind,
          blank: true,
        };
        // Drop the previous task/chat so the shell shows the centred empty state.
        this.snapshot = initialSnapshot();
        this.handlers?.onBootstrap({
          session: blank,
          sessions: [blank, ...SESSION_LIST.filter((s) => s.id !== sessionId)],
          provider: BOOTSTRAP_PROVIDER,
          providerStatus: BOOTSTRAP_PROVIDER_STATUS,
        });
        this.answer(command.commandId, { sessionId });
        return;
      }
      case 'select_session':
        this.answer(command.commandId, { ok: true });
        return;
      case 'select_provider':
        this.push('provider.selected', {
          providerId: command.payload.providerId,
          model: command.payload.model ?? 'default',
          reason: 'user selection',
        });
        return;
      // ---- chat (对话 mode): the same chat.* events a live engine emits -----
      case 'chat_message': {
        const turnId = `turn_${(this.sent.length * 6151 + 2749).toString(16)}`;
        const answer =
          '这是对话模式的直答回复（offline fixture）。真实引擎在这里流式输出模型回复，并按所选权限策略使用工具。';
        this.push('chat.received', { turnId, text: command.payload.text });
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

/** Canned but plausible tool output for a command-driven approval. */
function fixtureOutput(call: Pick<ToolCall, 'name' | 'input'>): JsonValue {
  if (call.name === 'shell.run') {
    const cmd = (call.input as { cmd?: string } | null)?.cmd ?? 'command';
    return { exitCode: 0, cmd, stdout: 'ok', durationMs: 412 };
  }
  if (call.name === 'fs.read') return { lines: 42, bytes: 1180 };
  return { ok: true };
}