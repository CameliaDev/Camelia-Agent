/**
 * Engine server — puts the runtime's event stream on a socket for the webview.
 *
 * `camelia serve` runs this. It is deliberately thin: it owns *transport*, never
 * business state. Domain events flow out over SSE unchanged, commands flow in over
 * `POST /command` and are mapped straight onto `CameliaRuntime` methods. Anything the
 * engine cannot honour is reported as a rejection rather than faked, so the UI never
 * shows an action that did not happen (whitepaper §6.1).
 *
 * Loopback-only by default: the API key lives in `~/.camelia`, so binding this to a
 * routable interface would hand out the user's model credentials.
 * @module
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Command, DomainEvent, Id, LoggerPort, MemoryLayer, StoredEvent } from '@camelia/core';
import type { CameliaRuntime } from '@camelia/agent';
import {
  ENGINE_ROUTES,
  SSE_FRAME,
  toSessionView,
  type CommandAck,
  type EngineHealth,
} from '@camelia/agent/view';

import type { ApprovalBroker } from './ApprovalBroker.js';

const MEMORY_LAYERS = new Set<MemoryLayer>(['working', 'short', 'long', 'procedural']);

function isMemoryLayer(value: unknown): value is MemoryLayer {
  return typeof value === 'string' && MEMORY_LAYERS.has(value as MemoryLayer);
}

export interface EngineServerOptions {
  runtime: CameliaRuntime;
  broker: ApprovalBroker;
  /** Bind address. Defaults to `127.0.0.1` — never expose model credentials. */
  host?: string;
  /** Port. Defaults to 7433; `0` picks a free port (tests). */
  port?: number;
  /** Origins allowed to call the engine. Defaults to `['*']` (loopback only). */
  allowedOrigins?: string[];
  /** SSE keep-alive period. Defaults to 15s. */
  heartbeatMs?: number;
  /** How many persisted events to replay to a (re)connecting client. */
  replayLimit?: number;
  /** Skip the clarify model call (used with the scripted provider). */
  offlineClarify?: boolean;
  /** Submit this task as soon as the first client attaches — demos and screenshots. */
  autoRun?: string;
  logger?: LoggerPort;
}

export interface EngineAddress {
  host: string;
  port: number;
  url: string;
}

interface Client {
  res: ServerResponse;
  heartbeat: ReturnType<typeof setInterval>;
  detach: () => void;
}

/** Drop the events that are pure noise for a UI: raw metrics and non-stream logs. */
function isUiRelevant(event: DomainEvent): boolean {
  if (event.type === 'metric') return false;
  if (event.type === 'log') {
    const meta = (event.payload as { meta?: { stream?: boolean } }).meta;
    return meta?.stream === true;
  }
  return true;
}

function sseFrame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

const TERMINAL = new Set(['task.completed', 'task.failed', 'task.cancelled']);

export class EngineServer {
  private server?: Server;
  private readonly clients = new Set<Client>();
  private activeRun?: Promise<unknown>;
  private autoRunDone = false;
  private address?: EngineAddress;

  constructor(private readonly options: EngineServerOptions) {}

  get clientCount(): number {
    return this.clients.size;
  }

  get bound(): EngineAddress | undefined {
    return this.address;
  }

  async start(): Promise<EngineAddress> {
    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 7433;

    const server = createServer((req, res) => {
      this.route(req, res).catch((error: unknown) => {
        this.options.logger?.error('engine request failed', { error: String(error) });
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: 'internal error' } satisfies CommandAck));
      });
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const bound = server.address();
    const actualPort = typeof bound === 'object' && bound ? bound.port : port;
    this.address = { host, port: actualPort, url: `http://${host}:${actualPort}` };
    this.options.logger?.info('engine listening', { url: this.address.url });
    return this.address;
  }

  async stop(): Promise<void> {
    this.options.broker.rejectAll('engine shutting down');
    for (const client of [...this.clients]) this.dropClient(client);
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  // -------------------------------------------------------------------------
  // routing
  // -------------------------------------------------------------------------

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (method === 'OPTIONS') {
      res.writeHead(204, this.cors(req));
      res.end();
      return;
    }

    if (method === 'GET' && path === ENGINE_ROUTES.health) {
      const health: EngineHealth = {
        ok: true,
        sessionId: this.options.runtime.session.id,
        provider: this.options.runtime.session.provider,
        model: this.options.runtime.session.model,
        clients: this.clients.size,
      };
      this.sendJson(res, 200, health, req);
      return;
    }

    if (method === 'GET' && path === ENGINE_ROUTES.events) {
      await this.handleEvents(req, res, url);
      return;
    }

    if (method === 'POST' && path === ENGINE_ROUTES.command) {
      await this.handleCommand(req, res);
      return;
    }

    this.sendJson(res, 404, { ok: false, error: `no route for ${method} ${path}` } satisfies CommandAck, req);
  }

  // -------------------------------------------------------------------------
  // SSE
  // -------------------------------------------------------------------------

  private async handleEvents(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...this.cors(req),
    });
    res.write(sseFrame(SSE_FRAME.bootstrap, await this.bootstrap()));
    res.write(sseFrame(SSE_FRAME.status, { status: 'live' }));

    // Subscribe *before* replaying so an event emitted during the DB read is buffered,
    // not lost — a reconnect must not miss the event that ended the task.
    const buffered: DomainEvent[] = [];
    let live = false;
    const detach = this.options.runtime.bus.onAny((event) => {
      if (!isUiRelevant(event)) return;
      if (live) {
        this.write(res, sseFrame(SSE_FRAME.domain, event));
      } else {
        buffered.push(event);
      }
      if (live && TERMINAL.has(event.type)) {
        this.write(res, sseFrame(SSE_FRAME.status, { status: 'finished' }));
      }
    });

    const heartbeat = setInterval(() => this.write(res, ': keep-alive\n\n'), this.options.heartbeatMs ?? 15_000);
    heartbeat.unref?.();

    const client: Client = { res, heartbeat, detach };
    this.clients.add(client);

    const sessionId = url.searchParams.get('sessionId') ?? this.options.runtime.session.id;
    try {
      const history = await this.options.runtime.store.listEvents({
        sessionId,
        limit: this.options.replayLimit ?? 2_000,
      });
      for (const stored of history) {
        if (this.clients.has(client)) this.write(res, sseFrame(SSE_FRAME.domain, fromStored(stored)));
      }
    } catch (error) {
      this.options.logger?.warn('event replay failed', { error: String(error) });
    }

    live = true;
    for (const event of buffered) this.write(res, sseFrame(SSE_FRAME.domain, event));

    res.on('close', () => this.dropClient(client));

    if (this.options.autoRun && !this.autoRunDone) {
      this.autoRunDone = true;
      this.submit(this.options.autoRun);
    }
  }

  private async bootstrap(): Promise<{
    session: ReturnType<typeof toSessionView>;
    sessions: ReturnType<typeof toSessionView>[];
    provider: { activeProvider?: string; activeModel?: string };
  }> {
    const runtime = this.options.runtime;
    const sessions = await runtime.store.listSessions();
    const chain = runtime.providerChain();
    const active = chain.find((p) => p.active);
    return {
      session: toSessionView(runtime.session),
      sessions: sessions.map(toSessionView),
      provider: { activeProvider: active?.id, activeModel: runtime.modelInfo.model },
    };
  }

  private write(res: ServerResponse, chunk: string): void {
    if (res.writableEnded) return;
    try {
      res.write(chunk);
    } catch {
      // The socket died mid-write; the close handler does the cleanup.
    }
  }

  private dropClient(client: Client): void {
    if (!this.clients.delete(client)) return;
    clearInterval(client.heartbeat);
    client.detach();
    if (!client.res.writableEnded) client.res.end();
  }

  // -------------------------------------------------------------------------
  // commands
  // -------------------------------------------------------------------------

  private async handleCommand(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let command: Command;
    try {
      command = JSON.parse(await readBody(req)) as Command;
      if (!command || typeof command.type !== 'string') throw new Error('missing command type');
    } catch (error) {
      this.sendJson(res, 400, { ok: false, error: `invalid command body: ${String(error)}` } satisfies CommandAck, req);
      return;
    }
    const ack = await this.dispatch(command);
    this.sendJson(res, ack.ok ? 200 : 409, ack, req);
  }

  /** Map one UI command onto the runtime. Pure dispatch — no queuing, no magic. */
  private async dispatch(command: Command): Promise<CommandAck> {
    switch (command.type) {
      case 'submit_task':
        return this.submit(command.payload.intent);
      case 'resume_task':
        return this.resume(command.payload.taskId);
      case 'approve_tool':
        return this.options.broker.settle(command.payload.callId, true)
          ? { ok: true }
          : { ok: false, error: `no pending approval for call ${command.payload.callId}` };
      case 'deny_tool':
        return this.options.broker.settle(command.payload.callId, false)
          ? { ok: true }
          : { ok: false, error: `no pending approval for call ${command.payload.callId}` };
      case 'approve_plan':
        return this.options.runtime.approvePlan(command.payload.taskId, command.payload.scope)
          ? { ok: true }
          : { ok: false, error: `no plan is waiting for ${command.payload.taskId}` };
      case 'reject_plan':
        return this.options.runtime.rejectPlan(command.payload.taskId, command.payload.reason)
          ? { ok: true }
          : { ok: false, error: `no plan is waiting for ${command.payload.taskId}` };
      case 'edit_plan':
        return this.options.runtime.editPlan(command.payload.taskId, command.payload.edits)
          ? { ok: true }
          : { ok: false, error: `no plan is waiting for ${command.payload.taskId}` };
      case 'set_plan_approval':
        this.options.runtime.setPlanApproval(command.payload.mode);
        return { ok: true };
      case 'pause_task':
        return this.options.runtime.pause(command.payload.reason)
          ? { ok: true }
          : { ok: false, error: 'no task is running' };
      case 'cancel_task':
        return this.options.runtime.cancel(command.payload.reason)
          ? { ok: true }
          : { ok: false, error: 'no task is running' };
      case 'intervene_goal':
        return this.options.runtime.intervene(command.payload.instruction)
          ? { ok: true }
          : { ok: false, error: 'no task is running to steer' };
      case 'rollback_step':
        return { ok: false, error: 'rollback is not available from the live engine yet' };
      case 'select_provider':
        return { ok: false, error: 'provider switching mid-session is not available yet' };

      // ---- memory panel (Iteration 22) -----------------------------------
      case 'list_memories': {
        const { layer } = command.payload;
        if (layer !== undefined && !isMemoryLayer(layer)) {
          return { ok: false, error: `invalid memory layer: ${String(layer)}` };
        }
        const items = await this.options.runtime.memoryPanel.list(layer);
        return { ok: true, data: items };
      }
      case 'get_memory': {
        if (!command.payload.memoryId) return { ok: false, error: 'memoryId is required' };
        const item = await this.options.runtime.memoryPanel.get(command.payload.memoryId);
        return { ok: true, data: item };
      }
      case 'list_forget_log': {
        const entries = await this.options.runtime.memoryPanel.forgetLog(command.payload.limit ?? 200);
        return { ok: true, data: entries };
      }
      case 'list_reactivation_due': {
        const items = await this.options.runtime.memoryPanel.reactivationDue(command.payload.limit ?? 3);
        return { ok: true, data: items };
      }
      case 'mark_memory_incorrect': {
        if (!command.payload.memoryId) return { ok: false, error: 'memoryId is required' };
        return this.options.runtime.memoryPanel.markIncorrect(
          command.payload.memoryId,
          command.payload.reason ?? 'user-correction',
        );
      }
      case 'forget_memory': {
        if (!command.payload.memoryId) return { ok: false, error: 'memoryId is required' };
        return this.options.runtime.memoryPanel.forget(
          command.payload.memoryId,
          command.payload.reason ?? 'manual',
        );
      }
      case 'promote_memory': {
        if (!command.payload.memoryId) return { ok: false, error: 'memoryId is required' };
        return this.options.runtime.memoryPanel.promote(command.payload.memoryId);
      }
      case 'get_memory_health': {
        const health = await this.options.runtime.memoryPanel.health();
        return { ok: true, data: health };
      }

      default:
        return { ok: false, error: `unsupported command` };
    }
  }

  private submit(intent: string): CommandAck {
    if (this.activeRun) return { ok: false, error: 'a task is already running' };
    const trimmed = intent.trim();
    if (!trimmed) return { ok: false, error: 'empty intent' };
    this.activeRun = this.options.runtime
      .run(trimmed, { offlineClarify: this.options.offlineClarify ?? false })
      .catch((error: unknown) => {
        this.options.logger?.error('task run failed', { error: String(error) });
      })
      .finally(() => {
        this.activeRun = undefined;
      });
    return { ok: true };
  }

  private resume(taskId: Id): CommandAck {
    if (this.activeRun) return { ok: false, error: 'a task is already running' };
    this.activeRun = this.options.runtime
      .run('', { resumeTaskId: taskId })
      .catch((error: unknown) => {
        this.options.logger?.error('task resume failed', { error: String(error) });
      })
      .finally(() => {
        this.activeRun = undefined;
      });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // http helpers
  // -------------------------------------------------------------------------

  private cors(req: IncomingMessage): Record<string, string> {
    const allowed = this.options.allowedOrigins ?? ['*'];
    const origin = req.headers.origin;
    const value = allowed.includes('*') ? (origin ?? '*') : origin && allowed.includes(origin) ? origin : '';
    const headers: Record<string, string> = {
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };
    if (value) headers['access-control-allow-origin'] = value;
    return headers;
  }

  private sendJson(res: ServerResponse, status: number, body: unknown, req: IncomingMessage): void {
    res.writeHead(status, { 'content-type': 'application/json', ...this.cors(req) });
    res.end(JSON.stringify(body));
  }
}

function fromStored(stored: StoredEvent): DomainEvent {
  return {
    type: stored.type,
    payload: stored.payload,
    traceId: stored.traceId,
    sessionId: stored.sessionId,
    taskId: stored.taskId,
    ts: stored.ts,
    seq: stored.seq,
  } as unknown as DomainEvent;
}

/** Read a bounded request body. A command envelope is small; 1 MiB is generous. */
async function readBody(req: IncomingMessage, limit = 1_048_576): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}