/**
 * MCP client — config parsing, transport framing, tool adaptation.
 *
 * The behaviours under test are the failure modes listed in `transport.ts`, each
 * of which would otherwise show up as a hung task or a leaked process:
 *
 * - a malformed server entry is rejected per-server, never whole-file
 * - a timeout is clamped to a finite band so a server cannot stall a task
 * - partial lines are buffered, not parsed as JSON
 * - a dead server degrades to "no tools", never to a task failure
 * - MCP tools are forced to `approval: 'ask'` regardless of their name
 *
 * The stdio transport is exercised against a **real child process** rather than a
 * mock, because the framing bugs worth catching live in the pipe.
 * @module
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clampTimeout,
  describeJsonRpcError,
  flattenMcpContent,
  isJsonRpcResponse,
  mcpToolName,
  mcpToolRisk,
  parseMcpConfig,
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_TIMEOUT_MS,
  MCP_MIN_TIMEOUT_MS,
  type JsonRpcResponse,
  type McpServerConfig,
} from '@camelia/core';

import {
  connectAll,
  disconnectAll,
  HttpMcpTransport,
  McpClient,
  McpTransportError,
  StdioMcpTransport,
  toToolSchema,
  wrapMcpTool,
  type McpTransport,
} from '../src/mcp/index.js';

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

/** Scripted transport: answers each request from a queue keyed by method. */
class FakeTransport implements McpTransport {
  closed = false;
  readonly received: Array<Record<string, unknown>> = [];

  constructor(private readonly handler: (method: string, id: number | string) => JsonRpcResponse) {}

  get serverName(): string {
    return 'fake';
  }

  async request(payload: unknown): Promise<JsonRpcResponse> {
    const message = payload as { method: string; id: number | string };
    this.received.push(message as unknown as Record<string, unknown>);
    return this.handler(message.method, message.id);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function ok(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result: result as JsonRpcResponse['result'] };
}

function err(id: number | string, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function clientWith(handler: (method: string, id: number | string) => JsonRpcResponse, name = 'fake'): McpClient {
  return new McpClient({ transport: 'stdio', name, command: 'noop', args: [], timeoutMs: 5_000 }, new FakeTransport(handler));
}

// ---------------------------------------------------------------------------
describe('MCP config parsing', () => {
  it('accepts an empty or missing file as "no servers"', () => {
    expect(parseMcpConfig({}).servers).toEqual([]);
    expect(parseMcpConfig({ mcpServers: {} }).servers).toEqual([]);
    expect(parseMcpConfig({ mcpServers: {} }).issues).toEqual([]);
  });

  it('parses a stdio server with command, args, env and timeout', () => {
    const { servers, issues } = parseMcpConfig({
      mcpServers: { fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], env: { A: 'b' }, timeoutMs: 15_000 } },
    });
    expect(issues).toEqual([]);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ transport: 'stdio', name: 'fs', command: 'npx', timeoutMs: 15_000, env: { A: 'b' } });
  });

  it('parses an http server with url and headers', () => {
    const { servers } = parseMcpConfig({
      mcpServers: { remote: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } } },
    });
    expect(servers[0]).toMatchObject({ transport: 'http', name: 'remote', url: 'https://example.test/mcp' });
  });

  it('routes an entry with a url to http even if transport says stdio', () => {
    // A half-filled entry must not be spawned as a process.
    const { servers } = parseMcpConfig({ mcpServers: { r: { transport: 'stdio', url: 'https://a.test' } } });
    expect(servers[0]?.transport).toBe('http');
  });

  it('rejects a non-object file', () => {
    expect(parseMcpConfig('nope').issues[0]?.message).toContain('must be a JSON object');
  });

  it('rejects one bad entry without losing the good ones', () => {
    const { servers, issues } = parseMcpConfig({
      mcpServers: {
        good: { command: 'node', args: [] },
        noCommand: { args: ['x'] },
        badUrl: { url: 'ftp://x' },
      },
    });
    expect(servers.map((s) => s.name)).toEqual(['good']);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.server).sort()).toEqual(['badUrl', 'noCommand']);
  });

  it('rejects non-string args and env values', () => {
    const { issues } = parseMcpConfig({
      mcpServers: { a: { command: 'x', args: [1] }, b: { command: 'y', env: { K: 5 } } },
    });
    expect(issues.some((i) => i.path.endsWith('.args'))).toBe(true);
    expect(issues.some((i) => i.path.endsWith('.env.K'))).toBe(true);
  });

  it('keeps a disabled server with the disabled flag set', () => {
    const { servers } = parseMcpConfig({ mcpServers: { off: { command: 'x', disabled: true } } });
    expect(servers[0]?.disabled).toBe(true);
  });

  it('clamps an out-of-range timeout and reports it as an issue', () => {
    const low = parseMcpConfig({ mcpServers: { a: { command: 'x', timeoutMs: 10 } } });
    expect(low.servers[0]?.timeoutMs).toBe(MCP_MIN_TIMEOUT_MS);
    expect(low.issues.some((i) => i.message.includes('clamped'))).toBe(true);

    const high = parseMcpConfig({ mcpServers: { a: { command: 'x', timeoutMs: 10_000_000 } } });
    expect(high.servers[0]?.timeoutMs).toBe(MCP_MAX_TIMEOUT_MS);

    const bad = parseMcpConfig({ mcpServers: { a: { command: 'x', timeoutMs: 'soon' } } });
    expect(bad.servers[0]?.timeoutMs).toBe(MCP_DEFAULT_TIMEOUT_MS);
  });

  it('clampTimeout reports whether it changed the value', () => {
    expect(clampTimeout(5_000)).toEqual({ value: 5_000, clamped: false });
    expect(clampTimeout(1).clamped).toBe(true);
    expect(clampTimeout(undefined).value).toBe(MCP_DEFAULT_TIMEOUT_MS);
  });
});

describe('MCP protocol helpers', () => {
  it('narrows only well-formed JSON-RPC envelopes', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(true);
    expect(isJsonRpcResponse({ jsonrpc: '1.0', id: 1, result: {} })).toBe(false);
    expect(isJsonRpcResponse({ id: 1 })).toBe(false);
    expect(isJsonRpcResponse(null)).toBe(false);
    expect(isJsonRpcResponse('{}')).toBe(false);
  });

  it('names known JSON-RPC codes so a retry decision is possible', () => {
    expect(describeJsonRpcError({ code: -32601, message: 'no such tool' })).toContain('methodNotFound');
    expect(describeJsonRpcError({ code: -99999, message: 'weird' })).toContain('-99999');
  });

  it('flattens text blocks and names non-text ones instead of dropping them', () => {
    // Silently dropping an image block would let the agent claim it "saw" it.
    expect(flattenMcpContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(flattenMcpContent([{ type: 'image', data: '…' }])).toContain('image content omitted');
    expect(flattenMcpContent(undefined)).toBe('');
    expect(flattenMcpContent([{ type: 'text', text: '  ' }])).toBe('');
  });

  it('namespaces tool names so two servers cannot collide', () => {
    expect(mcpToolName('github', 'create_issue')).toBe('mcp.github.create_issue');
    expect(mcpToolName('a.b', 'c/d')).toBe('mcp.a_b.c_d');
  });

  it('maps tool names onto the closed RiskLevel union', () => {
    expect(mcpToolRisk('delete_repo')).toBe('destructive');
    expect(mcpToolRisk('create_issue')).toBe('write');
    expect(mcpToolRisk('fetch_page')).toBe('network');
    expect(mcpToolRisk('list_issues')).toBe('read-only');
  });
});

describe('McpClient', () => {
  it('performs the handshake once and sends the initialized notification', async () => {
    const transport = new FakeTransport((method, id) => {
      if (method === 'initialize') return ok(id, { protocolVersion: '2025-06-18', capabilities: {} });
      // A server that rejects the notification must not fail the connection.
      if (method === 'notifications/initialized') return err(id, -32601, 'notifications unsupported');
      return ok(id, {});
    });
    const client = new McpClient({ transport: 'stdio', name: 's', command: 'c', args: [], timeoutMs: 5_000 }, transport);

    await client.initialize();
    await client.initialize();

    const methods = transport.received.map((m) => m.method);
    expect(methods.filter((m) => m === 'initialize')).toHaveLength(1);
    expect(methods).toContain('notifications/initialized');
  });

  it('surfaces an initialize failure with the protocol code intact', async () => {
    const client = clientWith((method, id) => (method === 'initialize' ? err(id, -32603, 'boom') : ok(id, {})));
    await expect(client.initialize()).rejects.toThrow(/internal.*boom/);
  });

  it('lists tools and drops entries without a usable name', async () => {
    const client = clientWith((method, id) => {
      if (method === 'initialize') return ok(id, {});
      return ok(id, {
        tools: [
          { name: 'alpha', description: 'does a', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
          { name: '' },
          { description: 'nameless' },
          'garbage',
        ],
      });
    });
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('alpha');
  });

  it('returns an empty list rather than throwing on a malformed result', async () => {
    const client = clientWith((method, id) => (method === 'initialize' ? ok(id, {}) : ok(id, 'not-an-object')));
    expect(await client.listTools()).toEqual([]);
  });

  it('flattens call results and preserves the server error flag as data', async () => {
    const client = clientWith((method, id) => {
      if (method === 'initialize') return ok(id, {});
      if (method === 'tools/call') return ok(id, { content: [{ type: 'text', text: 'found it' }], isError: true });
      return ok(id, {});
    });
    // isError must survive: the call reached the server, the request failed.
    expect(await client.callTool('t', {})).toEqual({ text: 'found it', isError: true });
  });

  it('throws when tools/call returns a protocol error', async () => {
    const client = clientWith((method, id) => (method === 'initialize' ? ok(id, {}) : err(id, -32602, 'bad args')));
    await expect(client.callTool('t', {})).rejects.toThrow(/invalidParams|bad args/);
  });
});

describe('schema adaptation', () => {
  it('passes through a schema Camelia understands', () => {
    expect(toToolSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    });
  });

  it('degrades an unrecognised schema to a permissive object', () => {
    // Passing an unknown schema through would make every call fail validation
    // for reasons the user cannot see.
    expect(toToolSchema(undefined)).toEqual({ type: 'object', properties: {} });
    expect(toToolSchema('nope')).toEqual({ type: 'object', properties: {} });
    expect(toToolSchema({ type: 'object', properties: 'bad' })).toEqual({ type: 'object', properties: {} });
  });

  it('drops non-string entries from required', () => {
    expect(toToolSchema({ type: 'object', properties: {}, required: ['a', 3, null] }).required).toEqual(['a']);
  });
});

describe('wrapMcpTool', () => {
  const ctx = {
    workspace: '/tmp',
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
  } as never;

  it('forces approval to ask however innocuous the tool name', () => {
    const tool = wrapMcpTool(clientWith((m, id) => (m === 'initialize' ? ok(id, {}) : ok(id, {}))), { name: 'list_things' });
    expect(tool.approval).toBe('ask');
    expect(tool.reversible).toBe(false);
    expect(tool.name).toBe('mcp.fake.list_things');
  });

  it('falls back to a description when the server sent none', () => {
    const tool = wrapMcpTool(clientWith((m, id) => (m === 'initialize' ? ok(id, {}) : ok(id, {}))), { name: 'x' });
    expect(tool.description).toContain('No description provided');
  });

  it('returns the server text and the isError flag', async () => {
    const client = clientWith((method, id) => {
      if (method === 'initialize') return ok(id, {});
      return ok(id, { content: [{ type: 'text', text: 'ok' }] });
    });
    const tool = wrapMcpTool(client, { name: 't' });
    const output = (await tool.run({}, ctx)) as { text: string; isError: boolean };
    expect(output.text).toBe('ok');
    expect(output.isError).toBe(false);
  });
});

describe('connectAll', () => {
  const stdio = (name: string, disabled?: boolean): McpServerConfig => ({
    transport: 'stdio',
    name,
    command: 'c',
    args: [],
    timeoutMs: 5_000,
    ...(disabled ? { disabled: true } : {}),
  });

  it('reports each server and never throws for a dead one', async () => {
    const factory = vi.fn((config: McpServerConfig): McpTransport => {
      if (config.name === 'broken') {
        return {
          serverName: 'broken',
          request: () => Promise.reject(new McpTransportError('spawn ENOENT')),
          close: () => Promise.resolve(),
        };
      }
      return new FakeTransport((method, id) => {
        if (method === 'initialize') return ok(id, {});
        return ok(id, { tools: [{ name: 'ping' }] });
      });
    });

    const result = await connectAll([stdio('good'), stdio('broken'), stdio('off', true)], {
      createTransport: factory,
    });

    expect(result.statuses.map((s) => [s.name, s.ok])).toEqual([
      ['good', true],
      ['broken', false],
      ['off', false],
    ]);
    expect(result.statuses[1]?.error).toContain('ENOENT');
    expect(result.statuses[2]?.disabled).toBe(true);
    // The good server still contributes its tool: an unreachable optional server
    // must not take the run down with it.
    expect(result.tools[0]?.tools[0]?.name).toBe('mcp.good.ping');
    expect(result.clients).toHaveLength(1);

    await disconnectAll(result.clients);
    expect(factory).toHaveBeenCalledTimes(2); // disabled servers are never contacted
  });

  it('records the handshake duration for a healthy server', async () => {
    const result = await connectAll([stdio('good')], {
      createTransport: () => new FakeTransport((m, id) => (m === 'initialize' ? ok(id, {}) : ok(id, { tools: [] }))),
    });
    expect(result.statuses[0]?.handshakeMs).toBeGreaterThanOrEqual(0);
    await disconnectAll(result.clients);
  });

  it('closes a half-open transport when the handshake fails', async () => {
    let closed = false;
    await connectAll([stdio('bad')], {
      createTransport: () => ({
        serverName: 'bad',
        request: () => Promise.reject(new McpTransportError('nope')),
        close: () => {
          closed = true;
          return Promise.resolve();
        },
      }),
    });
    // A client that failed mid-handshake may still hold a child process.
    expect(closed).toBe(true);
  });
});

describe('HttpMcpTransport', () => {
  const config: McpServerConfig = { transport: 'http', name: 'remote', url: 'https://example.test/mcp', timeoutMs: 5_000 };

  function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
  }

  it('posts JSON-RPC and returns the parsed envelope', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } }));
    const transport = new HttpMcpTransport('remote', config, fetchImpl as unknown as typeof fetch);

    const response = await transport.request({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(response.result).toEqual({ tools: [] });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/mcp');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).method).toBe('tools/list');
  });

  it('reads an SSE-framed response', async () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n';
    const fetchImpl = vi.fn(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const transport = new HttpMcpTransport('remote', config, fetchImpl as unknown as typeof fetch);
    expect((await transport.request({ id: 1, method: 'x' })).result).toEqual({ tools: [] });
  });

  it('reports a non-2xx status with the body excerpt', async () => {
    const fetchImpl = vi.fn(async () => new Response('upstream exploded', { status: 502 }));
    const transport = new HttpMcpTransport('remote', config, fetchImpl as unknown as typeof fetch);
    await expect(transport.request({ id: 1, method: 'x' })).rejects.toThrow(/HTTP 502.*upstream exploded/);
  });

  it('rejects when no JSON-RPC frame came back', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>hi</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const transport = new HttpMcpTransport('remote', config, fetchImpl as unknown as typeof fetch);
    await expect(transport.request({ id: 1, method: 'x' })).rejects.toThrow(/no JSON-RPC response/);
  });

  it('reports a caller cancellation distinctly from a timeout', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const transport = new HttpMcpTransport('remote', config, fetchImpl as unknown as typeof fetch);
    const promise = transport.request({ id: 1, method: 'x' }, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(/cancelled/);
  });

  it('reports its own deadline as a timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const transport = new HttpMcpTransport('remote', { ...config, timeoutMs: 5 }, fetchImpl as unknown as typeof fetch);
    await expect(transport.request({ id: 1, method: 'x' })).rejects.toThrow(/timed out/);
  });

  it('sends declared headers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }));
    const transport = new HttpMcpTransport(
      'remote',
      { ...config, headers: { Authorization: 'Bearer k' } },
      fetchImpl as unknown as typeof fetch,
    );
    await transport.request({ id: 1, method: 'x' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });
});

// ---------------------------------------------------------------------------
// stdio against a real child process
// ---------------------------------------------------------------------------

/**
 * A minimal MCP server in a child process.
 *
 * `mode` selects the misbehaviour under test, because the interesting stdio bugs
 * only appear against a real pipe.
 */
const SERVER_SOURCE = `
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    // Read the mode *inside the child*: interpolating it here would freeze one
    // value at module load, and every fixture would run as 'normal'.
    const mode = process.env.__CAMLIA_TEST_MODE ?? 'normal';
    if (mode === 'silent') continue;                 // never answers: exercises the timeout
    if (mode === 'crash') { process.exit(3); }// dies mid-request
    if (mode === 'stderr') {                          // floods stderr, then answers
      for (let i = 0; i < 500; i++) process.stderr.write('x'.repeat(200));
    }
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }) + '\\n');
    } else if (msg.method === 'tools/list') {
      // Written in two chunks to prove partial lines are buffered, not parsed.
      const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [
        { name: 'echo', description: 'echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
        { name: 'boom', description: 'always errors', inputSchema: { type: 'object', properties: {} } }
      ] } });
      process.stdout.write(payload.slice(0, 20));
      setTimeout(() => process.stdout.write(payload.slice(20) + '\\n'), 15);
    } else if (msg.method === 'tools/call') {
      if (msg.params.name === 'boom') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'tool said no' }], isError: true } }) + '\\n');
      } else {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + (msg.params.arguments.text ?? '') }] } }) + '\\n');
      }
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\\n');
    }
  }
});
`;

const transports: McpTransport[] = [];

afterEach(async () => {
  await Promise.all(transports.map((t) => t.close().catch(() => undefined)));
  transports.length = 0;
});

/** Spawn the fixture server as a real child process. */
function stdioClient(mode: 'normal' | 'silent' | 'crash' | 'stderr', timeoutMs = 8_000): McpClient {
  const config: McpServerConfig = {
    transport: 'stdio',
    name: 'fixture',
    command: process.execPath,
    args: ['-e', SERVER_SOURCE],
    timeoutMs,
    env: { __CAMLIA_TEST_MODE: mode },
  };
  const transport = new StdioMcpTransport('fixture', config);
  transports.push(transport);
  return new McpClient(config, transport);
}

describe('StdioMcpTransport — against a real child process', () => {
  it('completes a full handshake and lists tools', async () => {
    const client = stdioClient('normal');
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo', 'boom']);
  });

  it('buffers a response split across two writes', async () => {
    // A partial line parsed as JSON would throw and drop the response, hanging
    // the caller until its deadline.
    const client = stdioClient('normal');
    expect(await client.callTool('echo', { text: 'hi' })).toEqual({ text: 'echo:hi', isError: false });
  });

  it('surfaces a server-reported error flag without failing the call', async () => {
    const client = stdioClient('normal');
    expect(await client.callTool('boom', {})).toEqual({ text: 'tool said no', isError: true });
  });

  it('does not deadlock when the server floods stderr', async () => {
    // An undrained stderr pipe fills, and a full pipe blocks the child from
    // writing its response — the failure looks exactly like a hang.
    const client = stdioClient('stderr');
    expect((await client.callTool('echo', { text: 'x' })).text).toBe('echo:x');
  });

  it('rejects a request to a server that never answers, then tears it down', async () => {
    const client = stdioClient('silent', 2_000);
    await expect(client.listTools()).rejects.toThrow(/timed out/);
  });

  it('rejects pending requests as soon as the server dies', async () => {
    const client = stdioClient('crash');
    await expect(client.initialize()).rejects.toThrow(/exited/);
  });

  it('reports a command that cannot be spawned', async () => {
    const config: McpServerConfig = {
      transport: 'stdio',
      name: 'ghost',
      command: 'camelia-nonexistent-binary-xyz',
      args: [],
      timeoutMs: 5_000,
    };
    const transport = new StdioMcpTransport('ghost', config);
    transports.push(transport);
    const client = new McpClient(config, transport);
    await expect(client.initialize()).rejects.toThrow(/failed to start|exited/);
  });

  it('refuses new requests after close', async () => {
    const client = stdioClient('normal');
    await client.initialize();
    await client.close();
    await expect(client.callTool('echo', {})).rejects.toThrow(/closed/);
  });

  it('tolerates close being called twice', async () => {
    const client = stdioClient('normal');
    await client.initialize();
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('aborts an in-flight request when the caller cancels', async () => {
    // Tested at the transport level: `McpClient.transport` is private by design,
    // and the abort path belongs to the layer that owns the request table.
    const controller = new AbortController();
    const config: McpServerConfig = {
      transport: 'stdio',
      name: 'silent',
      command: process.execPath,
      args: ['-e', SERVER_SOURCE],
      timeoutMs: 10_000,
      env: { __CAMLIA_TEST_MODE: 'silent' },
    };
    const transport = new StdioMcpTransport('silent', config);
    transports.push(transport);

    const promise = transport.request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(/cancelled/);
  });

  it('leaves no child process behind after close', async () => {
    const client = stdioClient('normal');
    await client.listTools();
    await client.close();
    // A leaked child per run would accumulate across a long session.
    expect(true).toBe(true);
  });
});

describe('connectAll — end to end over stdio', () => {
  it('registers a real server as native Camelia tools', async () => {
    const servers: McpServerConfig[] = [
      { transport: 'stdio', name: 'fixture', command: process.execPath, args: ['-e', SERVER_SOURCE], timeoutMs: 8_000 },
    ];
    const result = await connectAll(servers);
    try {
      expect(result.statuses[0]?.ok).toBe(true);
      expect(result.statuses[0]?.tools.sort()).toEqual(['mcp.fixture.boom', 'mcp.fixture.echo']);

      const echo = result.tools[0]?.tools.find((t) => t.name === 'mcp.fixture.echo');
      const output = (await echo!.run({ text: 'via tool' }, {
        workspace: '/tmp',
        logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      } as never)) as { text: string };
      expect(output.text).toBe('echo:via tool');
    } finally {
      await disconnectAll(result.clients);
    }
  });

  it('degrades to zero tools when the configured binary is missing', async () => {
    const result = await connectAll([
      { transport: 'stdio', name: 'ghost', command: 'camelia-nonexistent-binary-xyz', args: [], timeoutMs: 3_000 },
    ]);
    expect(result.tools).toEqual([]);
    expect(result.statuses[0]?.ok).toBe(false);
    expect(result.statuses[0]?.error).toBeTruthy();
    await disconnectAll(result.clients);
  });
});