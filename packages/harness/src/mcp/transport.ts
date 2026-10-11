/**
 * MCP transports — the process/pipe boundary between Camelia and an MCP server.
 *
 * Both transports implement one interface, {@link McpTransport}, so the client
 * above is written once and tested against a fake.
 *
 * The hard part of talking to a subprocess over a pipe is not the protocol, it is
 * the failure modes. Four of them are handled here rather than in the client,
 * because only this layer can see them:
 *
 * 1. **A server that writes to stderr and never exits.** stderr is drained into a
 *    ring buffer, never left as a full pipe — a full stderr pipe deadlocks the
 *    child while we wait for a response that will never come.
 * 2. **A server that emits a partial line.** Responses are framed on newlines and
 *    a partial tail is buffered until the newline arrives, never parsed as JSON.
 * 3. **A server that dies mid-request.** A pending request rejects immediately on
 *    transport close instead of waiting out its full timeout.
 * 4. **A request outliving its caller.** Every request carries the caller's
 *    `AbortSignal`, so a cancelled task tears the request down instead of holding a
 *    slot until the deadline.
 * @module
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  isJsonRpcResponse,
  type JsonRpcResponse,
  type McpServerConfig,
} from '@camelia/core';

/** How many stderr characters to retain. Enough to diagnose, bounded to stay small. */
const STDERR_RING_LIMIT = 8_192;

export interface McpTransportOptions {
  /** Aborts the in-flight request; also tears down a stdio child process. */
  signal?: AbortSignal;
}

export interface McpTransport {
  /** Stable identifier used in traces and error messages. */
  readonly serverName: string;
  /** Send one JSON-RPC request and resolve with its response envelope. */
  request(payload: unknown, options?: McpTransportOptions): Promise<JsonRpcResponse>;
  /** Release the transport. Safe to call more than once. */
  close(): Promise<void>;
}

/** Shared newline-delimited JSON framing, so both transports frame identically. */
class LineFramer {
  private buffer = '';
  private readonly lines: string[] = [];

  /** Feed a chunk, return every complete line it produced. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split('\n');
    // The last element is either '' or an incomplete line: hold it back.
    this.buffer = parts.pop() ?? '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed.length > 0) this.lines.push(trimmed);
    }
    return this.lines.splice(0, this.lines.length);
  }
}

export class McpTransportError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'McpTransportError';
  }
}

/**
 * Stdio transport: spawn the server and speak line-delimited JSON-RPC on stdio.
 *
 * The child is spawned lazily on the first request rather than at construction, so
 * a server that fails to boot surfaces as a failed `initialize` the user sees,
 * not as a crash during plugin discovery.
 */
export class StdioMcpTransport implements McpTransport {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly framer = new LineFramer();
  private readonly pending = new Map<string | number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private stderrRing = '';
  private nextId = 1;
  private closing = false;

  constructor(
    readonly serverName: string,
    private readonly config: Extract<McpServerConfig, { transport: 'stdio' }>,
  ) {}

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;

    const child = spawn(this.config.command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.config.env },
      windowsHide: true,
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));

    // Draining stderr is mandatory: an undrained pipe fills, and a full pipe
    // blocks the child from writing anything else — including our response.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrRing = (this.stderrRing + chunk).slice(-STDERR_RING_LIMIT);
    });

    child.on('error', (error) => this.failAll(new McpTransportError(`MCP server '${this.serverName}' failed to start: ${error.message}`, error)));

    child.on('close', (code, signal) => {
      const detail = this.stderrRing.trim();
      const suffix = detail ? `: ${detail.split('\n').slice(-3).join(' | ')}` : '';
      this.failAll(
        new McpTransportError(
          `MCP server '${this.serverName}' exited (code=${code ?? 'null'} signal=${signal ?? 'null'})${suffix}`,
        ),
      );
    });

    return child;
  }

  private consume(chunk: string): void {
    for (const line of this.framer.push(chunk)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Non-JSON on stdout is a server bug (or debug spew). Ignore the line
        // rather than killing every pending request over one bad byte.
        continue;
      }
      if (!isJsonRpcResponse(parsed)) continue;
      const entry = this.pending.get(parsed.id);
      if (!entry) continue;
      this.pending.delete(parsed.id);
      entry.resolve(parsed);
    }
  }

  private failAll(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) entry.reject(error);
  }

  async request(payload: unknown, options: McpTransportOptions = {}): Promise<JsonRpcResponse> {
    if (this.closing) throw new McpTransportError(`MCP transport '${this.serverName}' is closed`);
    const child = this.ensureChild();

    const id = this.nextId++;
    const message = JSON.stringify({ ...(payload as Record<string, unknown>), id }) + '\n';

    return await new Promise<JsonRpcResponse>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => reject(new McpTransportError(`MCP server '${this.serverName}' timed out after ${this.config.timeoutMs}ms`)));
        // A server that cannot answer within its budget is not recoverable
        // in-band: kill it so the next attempt starts from a clean process.
        void this.close();
      }, this.config.timeoutMs);

      const onAbort = (): void => {
        finish(() => reject(new McpTransportError(`MCP request to '${this.serverName}' was cancelled`)));
        void this.close();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(id, {
        resolve: (response) => finish(() => resolve(response)),
        reject: (error) => finish(() => reject(error)),
      });

      child.stdin.write(message, (error) => {
        if (error) {
          finish(() => reject(new McpTransportError(`MCP server '${this.serverName}' stdin write failed: ${error.message}`, error)));
        }
      });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    const child = this.child;
    this.child = undefined;
    this.failAll(new McpTransportError(`MCP transport '${this.serverName}' closed`));
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      child.once('close', done);
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
      // Do not wait forever for a server that ignores stdin EOF.
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        resolve();
      }, 2_000);
    });
  }
}

/**
 * HTTP transport: Streamable HTTP — one POST per JSON-RPC request.
 *
 * Notification frames may arrive as SSE (`text/event-stream`) on the same
 * response; we read them for their `data:` payloads so a server that streams
 * progress does not deadlock us. Frames without a matching request id are ignored
 * rather than treated as errors.
 */
export class HttpMcpTransport implements McpTransport {
  constructor(
    readonly serverName: string,
    private readonly config: Extract<McpServerConfig, { transport: 'http' }>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(payload: unknown, options: McpTransportOptions = {}): Promise<JsonRpcResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new McpTransportError(
          `MCP server '${this.serverName}' returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      const raw = await response.text();

      const candidates: string[] = [];
      if (contentType.includes('text/event-stream')) {
        for (const line of raw.split('\n')) {
          if (line.startsWith('data:')) candidates.push(line.slice(5).trim());
        }
      } else if (raw.trim().length > 0) {
        candidates.push(raw);
      }

      for (const candidate of candidates) {
        try {
          const parsed: unknown = JSON.parse(candidate);
          if (isJsonRpcResponse(parsed)) return parsed;
        } catch {
          continue;
        }
      }

      throw new McpTransportError(
        `MCP server '${this.serverName}' returned no JSON-RPC response (content-type: ${contentType || 'unknown'})`,
      );
    } catch (error) {
      if (error instanceof McpTransportError) throw error;
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new McpTransportError(`MCP server '${this.serverName}' timed out after ${this.config.timeoutMs}ms`, error);
      }
      if (options.signal?.aborted) {
        throw new McpTransportError(`MCP request to '${this.serverName}' was cancelled`, error);
      }
      throw new McpTransportError(`MCP server '${this.serverName}' request failed: ${(error as Error).message}`, error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  async close(): Promise<void> {
    /* No persistent connection to release: each request is its own POST. */
  }
}

/** Build the transport a server config declares. */
export function createMcpTransport(config: McpServerConfig): McpTransport {
  return config.transport === 'http' ? new HttpMcpTransport(config.name, config) : new StdioMcpTransport(config.name, config);
}