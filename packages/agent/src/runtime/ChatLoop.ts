/**
 * ChatLoop — the direct conversation path (Work chat).
 *
 * A chat turn never enters the task state machine: no clarify, no approval
 * gate, no verify. The model thinks first — goal, constraints, a short plan —
 * and only then calls tools. That short plan is part of the reply.
 *
 * It streams model deltas straight into the event bus, runs tools through the
 * same ToolEngine/ApprovalGate pair as the executor, and can pause mid-turn to
 * ask the user a fixed-option question (`ask_user`), which the UI renders as a
 * picker. `invoke_subagents` hands a goal to the work-token delegation path.
 *
 * Permission posture is the user's per-session choice (`ChatPolicy`):
 * - `readonly-sandbox` — read tools run, everything else is denied (V1 sandbox:
 *   denial is fed back to the model, no directory redirection).
 * - `ask` — read tools run, the rest open the shared approval broker.
 * - `full` — everything runs.
 * @module
 */

import {
  newId,
  type ChatFolderPayload,
  type ChatImagePayload,
  type ChatPolicy,
  type ChatRequest,
  type EffortLevel,
  type EmitMeta,
  type EventBus,
  type Id,
  type JsonValue,
  type LLMContentPart,
  type LLMMessage,
  type LLMPort,
  type LLMToolCall,
  type LLMToolSchema,
  type LoggerPort,
  type MetricsPort,
  type RiskLevel,
  type SessionStore,
  type ToolCall,
} from '@camelia/core';
import { localNowPromptLine } from '@camelia/core';
import {
  ApprovalGate,
  WorkspaceJournal,
  isRetryableError,
  parseToolArguments,
  type ApprovalMode,
  type ApprovalResponder,
  type HarnessConfig,
  type HarnessPorts,
  type ToolContext,
  type ToolEngine,
} from '@camelia/harness';

import { paths } from '../config/paths.js';
import { effortInstruction } from './effort.js';

/** Model/tool round trips allowed inside one chat turn. */
const MAX_CHAT_ITERATIONS = 1000;
/** Kept messages per session (oldest dropped, never splitting a tool pair). */
const MAX_HISTORY_MESSAGES = 40;
/** How long the UI picker stays open before the turn continues without an answer. */
const ASK_TIMEOUT_MS = 5 * 60_000;
/** Retries for a transient stream error that produced no output. */
const LLM_STREAM_RETRIES = 3;
/** Tool feedback cap, mirroring the executor's bounded feedback. */
const FEEDBACK_CAP = 4000;

/**
 * The pseudo-tool the model calls when it needs the user to pick from options.
 * Schema-only: it is intercepted here before any ToolEngine lookup, so it must
 * not be registered as a real tool.
 */
const INVOKE_SUBAGENTS_SCHEMA: LLMToolSchema = {
  name: 'invoke_subagents',
  description:
    'Delegate a goal to one or more sub-AIs. The coordinator splits the work and shares recalled memory. Each sub-AI must think (goal, constraints, short plan) before it receives a work token. Without a token it cannot use tools. Out-of-bounds work is handed back.',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'The outcome the sub-AIs must deliver.' },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Bounds the sub-AIs must keep. Omit when the user named none.',
      },
    },
    required: ['goal'],
    additionalProperties: false,
  },
};

const ASK_USER_SCHEMA: LLMToolSchema = {
  name: 'ask_user',
  description:
    'Ask the user a clarifying question with fixed options when the answer cannot be inferred from context. Use sparingly.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'One short, specific question.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '2-4 concrete, mutually exclusive options.',
      },
    },
    required: ['question', 'options'],
    additionalProperties: false,
  },
};

/**
 * Work chat system prompt.
 *
 * Think, then a short plan, then tools. The short plan stays in the reply.
 * It does not open the task state machine.
 */
export function workChatSystemPrompt(policy: ChatPolicy, workspace: string, effort?: EffortLevel): string {
  const posture =
    policy === 'full'
      ? 'Permission mode: FULL — every tool runs directly.'
      : policy === 'ask'
        ? 'Permission mode: ASK — read-only tools run directly; any tool that writes, executes or reaches the network opens an approval prompt the user must answer.'
        : 'Permission mode: READ-ONLY SANDBOX — only read-only tools run; anything else is denied by policy.';
  const lines = [
    'You are Camelia in Work mode.',
    'Think before you act. Do not call a tool until the goal, the constraints, and a short plan are clear.',
    'For each request:',
    '1. Name the goal in one sentence.',
    '2. Name the constraints that bound the work (permission mode, the workspace, and anything the user said must not change).',
    '3. Write a short plan: a few ordered steps. If the answer needs no tools, the plan is one step: answer.',
    '4. Then call tools, and only for steps that need the workspace or current web knowledge. Use web_search for facts, docs, or news outside the workspace; cite the returned URLs. Never fabricate tool output.',
    'The short plan is part of the reply. It does not open the task state machine and it does not wait on a separate approval ritual.',
    'When the work should be split across sub-AIs, call invoke_subagents. Each sub-AI must think first and hold a work token before it can use tools. Out-of-bounds work is handed back to you.',
    localNowPromptLine(),
    `Workspace: ${workspace}`,
    posture,
    'If a tool is denied or fails, say plainly what you were trying to do and what you need — do not retry silently.',
    'When you cannot proceed without the user\'s input, call ask_user with one short question and 2-4 concrete options.',
  ];
  if (effort) lines.push(effortInstruction(effort));
  return lines.join('\n');
}

interface ChatStreamError {
  message: string;
  retryable: boolean;
}

export interface ChatLoopOptions {
  /** Absolute workspace root. */
  workspace: string;
  ports: HarnessPorts;
  tools: ToolEngine;
  bus: EventBus;
  store: SessionStore;
  logger: LoggerPort;
  metrics?: MetricsPort;
  config: HarnessConfig;
  /** The streaming LLM chain (the runtime's FallbackLLMPort). */
  fallback: LLMPort;
  /**
   * Model id used for chat turns.
   *
   * A string is snapshotted. A getter is read on every request so a composer or
   * settings switch applies to the next send without rebuilding this loop.
   */
  model: string | (() => string);
  /** Approval responder for the `ask` policy — the shared UI/CLI broker. */
  responder?: ApprovalResponder;
  /** Preset allowlist, same semantics as `RunContext.allowedTools`. */
  allowedTools?: string[];
  /**
   * Main-AI delegation. When omitted, `invoke_subagents` reports that
   * sub-AIs are not configured and does not pretend the work ran.
   */
  delegate?: (input: { sessionId: Id; goal: string; constraints: string[]; signal: AbortSignal }) => Promise<string>;
}

export class ChatLoop {
  private readonly active: { current?: AbortController } = {};
  /** Per-session conversation history (capped). */
  private readonly history = new Map<Id, LLMMessage[]>();
  /** Sessions whose first message already set the title. */
  private readonly titled = new Set<Id>();
  /** Open `ask_user` pickers, keyed by askId. */
  private readonly pendingAsks = new Map<Id, (idx: number) => void>();
  private lastPolicy?: ChatPolicy;

  constructor(private readonly opts: ChatLoopOptions) {}

  /** Point later turns at a new working folder without rebuilding the loop. */
  setWorkspace(workspace: string): void {
    this.opts.workspace = workspace;
  }

  /** Resolve the model at request time, not at construction time. */
  private resolveModel(): string {
    const model = this.opts.model;
    return typeof model === 'function' ? model() : model;
  }

  /** True while a turn is in flight — the server refuses further `chat_message`. */
  get busy(): boolean {
    return this.active.current !== undefined;
  }

  /**
   * Run one chat turn to completion. Emits the whole `chat.*` event family;
   * never throws for model/tool failures (they surface as `chat.failed`).
   * Throws only when another turn is already running.
   */
  async chat(
    sessionId: Id,
    text: string,
    policy: ChatPolicy,
    effort?: EffortLevel,
    images?: ChatImagePayload[],
    folders?: ChatFolderPayload[],
  ): Promise<void> {
    if (this.active.current) throw new Error('A chat turn is already in progress.');
    const controller = new AbortController();
    this.active.current = controller;
    const signal = controller.signal;

    const userTurnId = newId();
    const traceId = `c-${Date.now().toString(36)}`;
    const meta: EmitMeta = { traceId, sessionId };
    const journal = new WorkspaceJournal(paths.backups(), userTurnId, this.opts.ports.fs, this.opts.logger);
    const gate = this.gateFor(policy);
    let turnId = '';
    let textOut = '';
    // Set once a terminal `chat.message` / `chat.failed` has been emitted.
    // Tool rounds are not terminal — `finally` seals the run if we returned
    // without one (cancel mid-tool, crash before the closing message).
    let settled = false;

    try {
      const safeImages = sanitizeImages(images);
      const safeFolders = sanitizeFolders(folders);
      const userText = appendFolders(text, safeFolders);
      this.opts.bus.emit('chat.received', { turnId: userTurnId, text: userText, ...(safeImages.length ? { images: safeImages } : {}) }, meta);
      if (policy !== this.lastPolicy) {
        this.lastPolicy = policy;
        this.opts.bus.emit('chat.policy_changed', { policy }, meta);
      }
      await this.maybeTitle(
        sessionId,
        text.trim() || safeFolders[0]?.name || (safeImages.length ? `Image (${safeImages.length})` : text),
      );

      const messages = this.historyFor(sessionId);
      messages.push({ role: 'user', content: buildUserContent(userText, safeImages) });
      this.trimHistory(messages);

      const system: LLMMessage = { role: 'system', content: workChatSystemPrompt(policy, this.opts.workspace, effort) };
      const tools: LLMToolSchema[] = [...this.opts.tools.schemas(this.allowedTools()), ASK_USER_SCHEMA, INVOKE_SUBAGENTS_SCHEMA];

      for (let iteration = 0; iteration < MAX_CHAT_ITERATIONS; iteration += 1) {
        turnId = newId();
        let streamed = false; // has this iteration's assistant turn been opened?
        textOut = '';
        let calls: LLMToolCall[] = [];
        let streamError: ChatStreamError | undefined;

        const request: ChatRequest = {
          model: this.resolveModel(),
          messages: [system, ...messages],
          tools,
          temperature: this.opts.config.temperature,
        };

        let attempt = 0;
        for (;;) {
          attempt += 1;
          calls = [];
          textOut = '';
          streamError = undefined;
          try {
            for await (const chunk of this.opts.fallback.chat(request, signal)) {
              if (signal.aborted) break;
              if (chunk.type === 'text-delta') {
                streamed = true;
                textOut += chunk.text;
                this.opts.bus.emit('chat.delta', { turnId, delta: chunk.text }, meta);
              } else if (chunk.type === 'reasoning-delta') {
                streamed = true;
                this.opts.bus.emit('chat.delta', { turnId, delta: chunk.text, channel: 'thinking' }, meta);
              } else if (chunk.type === 'tool-call') {
                calls.push(chunk.call);
              } else if (chunk.type === 'error') {
                streamError = { message: chunk.message, retryable: chunk.retryable };
              }
            }
          } catch (err) {
            if (signal.aborted) break;
            const message = err instanceof Error ? err.message : String(err);
            streamError = { message, retryable: isRetryableError(message) };
          }
          if (signal.aborted) {
            // User cancel is not a failure: keep the partial text, no chat.failed.
            if (streamed) {
              this.opts.bus.emit('chat.message', { turnId, role: 'assistant', text: textOut }, meta);
              settled = true;
            }
            return;
          }
          if (
            streamError &&
            streamError.retryable &&
            !streamed &&
            calls.length === 0 &&
            attempt <= LLM_STREAM_RETRIES
          ) {
            this.opts.logger.warn('chat stream error — retrying', { attempt, error: streamError.message });
            continue;
          }
          break;
        }

        if (streamError) {
          if (!streamed) {
            // Open a turn so the failure is visible in the transcript.
            this.opts.bus.emit('chat.delta', { turnId, delta: '' }, meta);
            streamed = true;
          }
          if (textOut) {
            this.opts.bus.emit('chat.message', { turnId, role: 'assistant', text: textOut }, meta);
            messages.push({ role: 'assistant', content: textOut });
          }
          this.opts.bus.emit('chat.failed', { turnId, error: streamError.message }, meta);
          this.opts.logger.error('chat turn failed', { turnId, error: streamError.message });
          settled = true;
          return;
        }

        if (calls.length === 0) {
          // Final answer for the turn. This is the run's terminal message —
          // tool rounds above do not emit one, so the projection closes their
          // streaming flags here.
          this.opts.bus.emit('chat.message', { turnId, role: 'assistant', text: textOut }, meta);
          if (textOut) messages.push({ role: 'assistant', content: textOut });
          settled = true;
          return;
        }

        // Tool calls: make sure the turn exists so tool cards have somewhere to land.
        if (!streamed) {
          this.opts.bus.emit('chat.delta', { turnId, delta: '' }, meta);
          streamed = true;
        }
        messages.push({ role: 'assistant', content: textOut, toolCalls: calls });

        for (const call of calls) {
          const feedback =
            call.name === 'ask_user'
              ? await this.handleAskUser(call, meta, signal)
              : call.name === 'invoke_subagents'
                ? await this.handleInvokeSubagents(call, meta, signal)
                : await this.runTool(call, turnId, gate, journal, signal, meta);
          if (signal.aborted) return;
          messages.push({ role: 'tool', name: call.name, toolCallId: call.id, content: feedback });
        }
      }

      // Iteration budget exhausted without a final answer.
      this.opts.bus.emit('chat.delta', { turnId, delta: '' }, meta);
      this.opts.bus.emit('chat.failed', { turnId, error: `Stopped after ${MAX_CHAT_ITERATIONS} tool iterations.` }, meta);
      settled = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger.error('chat turn crashed', { error: message });
      if (turnId) {
        this.opts.bus.emit('chat.failed', { turnId, error: message }, meta);
        settled = true;
      }
    } finally {
      this.active.current = undefined;
      if (!settled) {
        // Cancel mid-tool, or a final iteration that never opened a turn.
        // Emitting the close is what drops `inflight` so the header can leave 思考中.
        this.opts.bus.emit(
          'chat.message',
          { turnId: turnId || userTurnId, role: 'assistant', text: textOut },
          meta,
        );
      }
    }
  }

  /** Resolve an open `ask_user` picker. Returns false when the askId is unknown. */
  answer(askId: Id, optionIdx: number): boolean {
    const settle = this.pendingAsks.get(askId);
    if (!settle) return false;
    settle(optionIdx);
    return true;
  }

  /** Abort the in-flight turn (if any) and dismiss every open picker. */
  cancel(): void {
    this.active.current?.abort();
    for (const settle of [...this.pendingAsks.values()]) settle(-1);
  }

  // -------------------------------------------------------------------------

  private allowedTools(): string[] | undefined {
    return this.opts.allowedTools;
  }

  /** Policy → ApprovalGate (Step 4 mapping). Built per turn; session approvals reset with it. */
  private gateFor(policy: ChatPolicy): ApprovalGate {
    const base = this.opts.config.approval;
    const byRisk: Record<RiskLevel, ApprovalMode> =
      policy === 'full'
        ? { 'read-only': 'auto', write: 'auto', destructive: 'auto', network: 'auto', privileged: 'auto' }
        : policy === 'ask'
          ? { 'read-only': 'auto', write: 'ask', destructive: 'ask', network: 'ask', privileged: 'ask' }
          : { 'read-only': 'auto', write: 'deny', destructive: 'deny', network: 'deny', privileged: 'deny' };
    return new ApprovalGate(
      { ...base, byRisk, rememberSessionApprovals: true },
      this.opts.responder,
      this.opts.logger,
      this.opts.metrics,
    );
  }

  private historyFor(sessionId: Id): LLMMessage[] {
    let messages = this.history.get(sessionId);
    if (!messages) {
      messages = [];
      this.history.set(sessionId, messages);
    }
    return messages;
  }

  private trimHistory(messages: LLMMessage[]): void {
    while (messages.length > MAX_HISTORY_MESSAGES) messages.shift();
    // Never start the window with an orphaned tool result.
    while (messages.length > 0 && messages[0]!.role === 'tool') messages.shift();
  }

  /** First message of a session names it (same rule as the task path). */
  private async maybeTitle(sessionId: Id, text: string): Promise<void> {
    if (this.titled.has(sessionId)) return;
    this.titled.add(sessionId);
    const title = text.trim().split('\n')[0]?.slice(0, 72) || 'New chat';
    try {
      await this.opts.store.updateSession(sessionId, { title });
    } catch (err) {
      this.opts.logger.warn('failed to set session title from chat', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Intercept `invoke_subagents`: the delegate owns the token gate and TeamOrchestrator. */
  private async handleInvokeSubagents(call: LLMToolCall, meta: EmitMeta, signal: AbortSignal): Promise<string> {
    const args = parseToolArguments(call.arguments) as { goal?: unknown; constraints?: unknown };
    const goal = typeof args?.goal === 'string' ? args.goal.trim() : '';
    if (!goal) return 'ERROR: invoke_subagents needs a goal.';
    const constraints = Array.isArray(args?.constraints)
      ? (args.constraints as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    if (!this.opts.delegate || !meta.sessionId) {
      return 'ERROR: sub-AI delegation is not configured. Say so to the user instead of inventing a worker result.';
    }
    try {
      return await this.opts.delegate({ sessionId: meta.sessionId, goal, constraints, signal });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `ERROR from invoke_subagents: ${message}`;
    }
  }

  /** Intercept the `ask_user` pseudo-tool: emit the picker, wait, report the choice. */
  private async handleAskUser(call: LLMToolCall, meta: EmitMeta, signal: AbortSignal): Promise<string> {
    const args = parseToolArguments(call.arguments) as { question?: unknown; options?: unknown };
    const question =
      typeof args?.question === 'string' && args.question.trim() ? args.question : 'Please choose an option.';
    const options = Array.isArray(args?.options)
      ? (args.options as unknown[]).filter((o): o is string => typeof o === 'string').slice(0, 4)
      : [];
    const askId = newId();
    this.opts.bus.emit('chat.ask_user', { askId, question, options }, meta);
    const idx = await this.waitAnswer(askId, signal);
    // optionIdx -1 (dismissed/timed out) clears the picker without a user turn.
    this.opts.bus.emit('chat.answered', { askId, optionIdx: idx }, meta);
    return idx >= 0 && options[idx] !== undefined
      ? options[idx]!
      : '(no answer — the user dismissed the question or it timed out; continue with your best judgment)';
  }

  private waitAnswer(askId: Id, signal: AbortSignal): Promise<number> {
    return new Promise<number>((resolve) => {
      let settled = false;
      const settle = (idx: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.pendingAsks.delete(askId);
        resolve(idx);
      };
      const timer = setTimeout(() => settle(-1), ASK_TIMEOUT_MS);
      const onAbort = () => settle(-1);
      this.pendingAsks.set(askId, settle);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * The executor's `runToolCall`, reduced to the chat path: same record shape,
   * same gate flow, but every status transition is announced via `chat.tool`
   * and nothing is persisted to the task tables — replaying the events
   * reconstructs the transcript.
   */
  private async runTool(
    call: LLMToolCall,
    turnId: Id,
    gate: ApprovalGate,
    journal: WorkspaceJournal,
    signal: AbortSignal,
    meta: EmitMeta,
  ): Promise<string> {
    const input = parseToolArguments(call.arguments);
    const tool = this.opts.tools.get(call.name);
    const record: ToolCall = {
      id: newId(),
      stepId: turnId,
      taskId: turnId,
      name: call.name,
      input,
      status: 'pending',
      risk: tool?.risk ?? 'privileged',
      reversible: tool?.reversible ?? false,
      traceId: meta.traceId,
      createdAt: this.opts.ports.clock.now(),
    };
    this.opts.bus.emit('chat.tool', { call: record }, meta);

    if (!tool) {
      record.status = 'error';
      record.error = `Unknown tool "${call.name}".`;
      this.opts.bus.emit('chat.tool', { call: record }, meta);
      return record.error;
    }

    // Preset allowlist — same §8.3 semantics as the executor.
    if (this.opts.allowedTools && !this.opts.allowedTools.includes('*') && !this.opts.allowedTools.includes(call.name)) {
      record.status = 'error';
      record.error = `Tool "${call.name}" is not permitted by the active agent preset.`;
      this.opts.bus.emit('chat.tool', { call: record }, meta);
      return `BLOCKED: ${record.error} Use only the tools offered to you.`;
    }

    const candidate = { callId: record.id, name: call.name, risk: record.risk, input, approval: tool.approval };
    // Announce the gate before awaiting consent (same rule as the executor).
    if (gate.needsApproval(candidate)) {
      record.status = 'awaiting-approval';
      this.opts.bus.emit('chat.tool', { call: record }, meta);
    }
    const decision = await gate.decide(candidate);
    if (!decision.allowed) {
      record.status = 'denied';
      record.error = decision.reason;
      this.opts.bus.emit('chat.tool', { call: record }, meta);
      return `DENIED (${decision.by}): ${decision.reason}. Explain to the user what you cannot do under the current permission policy instead of retrying.`;
    }
    record.status = 'approved';
    this.opts.bus.emit('chat.tool', { call: record }, meta);
    record.status = 'running';
    this.opts.bus.emit('chat.tool', { call: record }, meta);

    const ctx: ToolContext = {
      workspace: this.opts.workspace,
      fs: this.opts.ports.fs,
      shell: this.opts.ports.shell,
      search: this.opts.ports.search,
      logger: this.opts.logger,
      clock: this.opts.ports.clock,
      journal,
      signal,
    };
    try {
      const invocation = await withTimeout(this.opts.tools.invoke(call.name, input, ctx), this.opts.config.toolTimeoutMs);
      if (invocation.ok) {
        record.status = 'ok';
        record.output = invocation.output;
        record.durationMs = invocation.durationMs;
        this.opts.bus.emit('chat.tool', { call: record }, meta);
        return stringifyOutput(invocation.output);
      }
      record.status = 'error';
      record.error = invocation.error;
      record.durationMs = invocation.durationMs;
      this.opts.bus.emit('chat.tool', { call: record }, meta);
      return `ERROR from ${call.name}: ${invocation.error}${
        invocation.retryable ? ' (transient — you may retry once with corrected arguments)' : ''
      }`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record.status = 'error';
      record.error = message;
      this.opts.bus.emit('chat.tool', { call: record }, meta);
      return `ERROR from ${call.name}: ${message}`;
    }
  }
}

/** Per-tool wall clock, mirroring the executor. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`tool timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const MAX_CHAT_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

const MAX_CHAT_FOLDERS = 8;

function sanitizeFolders(folders: ChatFolderPayload[] | undefined): ChatFolderPayload[] {
  if (!folders?.length) return [];
  const out: ChatFolderPayload[] = [];
  for (const folder of folders) {
    if (out.length >= MAX_CHAT_FOLDERS) break;
    if (!folder || typeof folder.name !== 'string') continue;
    const name = folder.name.trim().replace(/^[/\\]+|[/\\]+$/g, '').slice(0, 120);
    if (!name || name === '.' || name === '..') continue;
    const folderPath = typeof folder.path === 'string' ? folder.path.trim().slice(0, 500) : '';
    out.push(folderPath ? { name, path: folderPath } : { name });
  }
  return out;
}

function appendFolders(text: string, folders: ChatFolderPayload[]): string {
  if (folders.length === 0) return text;
  const lines = folders.map((folder) => `- ${folder.name}${folder.path ? ` (${folder.path})` : ''}`);
  const trailer = `Attached folders:\n${lines.join('\n')}`;
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n\n${trailer}` : trailer;
}

function sanitizeImages(images: ChatImagePayload[] | undefined): ChatImagePayload[] {
  if (!images?.length) return [];
  const out: ChatImagePayload[] = [];
  for (const img of images) {
    if (out.length >= MAX_CHAT_IMAGES) break;
    if (!img || typeof img.mimeType !== 'string' || typeof img.dataBase64 !== 'string') continue;
    const mime = img.mimeType === 'image/jpg' ? 'image/jpeg' : img.mimeType;
    if (!ALLOWED_IMAGE_MIME.has(mime)) continue;
    const raw = img.dataBase64.replace(/\s+/g, '');
    if (!raw || raw.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) continue;
    out.push({ mimeType: mime, dataBase64: raw });
  }
  return out;
}

function buildUserContent(text: string, images: ChatImagePayload[]): string | LLMContentPart[] {
  const trimmed = text.trim();
  if (images.length === 0) return trimmed || text;
  const parts: LLMContentPart[] = [];
  if (trimmed) parts.push({ type: 'text', text: trimmed });
  for (const img of images) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
    });
  }
  if (parts.length === 0) parts.push({ type: 'text', text: '(image)' });
  return parts;
}

/** Bounded JSON feedback, mirroring the executor. */
function stringifyOutput(output: JsonValue): string {
  let text: string;
  try {
    text = JSON.stringify(output) ?? String(output);
  } catch {
    text = String(output);
  }
  return text.length > FEEDBACK_CAP ? `${text.slice(0, FEEDBACK_CAP)}…[truncated]` : text;
}
