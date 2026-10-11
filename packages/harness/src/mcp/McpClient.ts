/**
 * MCP client and tool adapter.
 *
 * Connects to configured MCP servers, performs the `initialize` handshake, lists
 * their tools, and wraps each one as a native Camelia {@link Tool} so it inherits
 * the ToolEngine, the ApprovalGate, the tracer and the workspace journal
 * (whitepaper §8.5).
 *
 * Two decisions worth stating:
 *
 * 1. **A dead server never becomes a task failure.** `connectAll` reports each
 *    server's status and returns the clients that did come up. A task proceeds
 *    with whatever tools are available; MCP is an *addition* to capability, not a
 *    dependency. The alternative — failing the whole task because one of three
 *    servers was unreachable — would make an optional extension point a hard
 *    requirement, which is exactly backwards.
 * 2. **Every wrapped tool asks before running.** MCP servers are third-party code
 *    that appeared after install, so `approval` is forced to `'ask'` regardless of
 *    how innocuous the tool name looks. `mcpToolRisk` still sets the displayed
 *    risk, but risk no longer grants auto-approval on this path.
 * @module
 */

import type { JsonSchema, JsonValue, LoggerPort, McpServerConfig, McpToolDescriptor } from '@camelia/core';
import {
  describeJsonRpcError,
  flattenMcpContent,
  mcpToolName,
  mcpToolRisk,
} from '@camelia/core';

import type { Tool, ToolContext, ToolResult } from '../tools/types.js';
import { createMcpTransport, McpTransportError, type McpTransport } from './transport.js';

/** MCP protocol revision Camelia speaks. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** How a configured server turned out. Surfaced by `camelia doctor`. */
export interface McpServerStatus {
  name: string;
  transport: McpServerConfig['transport'];
  ok: boolean;
  /** Tool names contributed, namespaced. Empty when the server failed. */
  tools: string[];
  /** Present when `ok` is false. */
  error?: string;
  /** True when the server was skipped because it is marked `disabled`. */
  disabled?: boolean;
  /** Round-trip time of the initialize handshake, in milliseconds. */
  handshakeMs?: number;
}

export interface McpClientOptions {
  logger?: LoggerPort;
  /** Injection seam for tests: build a transport for a config. */
  createTransport?: (config: McpServerConfig) => McpTransport;
}

/** One connected MCP server. */
export class McpClient {
  private initialized = false;

  constructor(
    readonly config: McpServerConfig,
    private readonly transport: McpTransport,
    private readonly logger?: LoggerPort,
  ) {}

  get name(): string {
    return this.config.name;
  }

  /**
   * Perform the MCP handshake.
   *
   * Idempotent: calling it twice is a no-op, so a reconnecting caller does not
   * pay for a second handshake.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const response = await this.transport.request({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        clientInfo: { name: 'camelia', version: '0.1.0' },
      },
    });
    if (response.error) {
      throw new McpTransportError(`initialize failed — ${describeJsonRpcError(response.error)}`);
    }
    this.initialized = true;

    // The spec requires a notification to move past the initializing state.
    // Servers that do not implement notifications answer with an error; that is
    // benign, so it is deliberately not escalated.
    await this.transport
      .request({ jsonrpc: '2.0', method: 'notifications/initialized' })
      .catch(() => undefined);
  }

  /** List the server's tools. */
  async listTools(): Promise<McpToolDescriptor[]> {
    await this.initialize();
    const response = await this.transport.request({ jsonrpc: '2.0', method: 'tools/list', params: {} });
    if (response.error) {
      throw new McpTransportError(`tools/list failed — ${describeJsonRpcError(response.error)}`);
    }
    const result = response.result;
    if (typeof result !== 'object' || result === null || Array.isArray(result)) return [];
    const tools = (result as { tools?: unknown }).tools;
    if (!Array.isArray(tools)) return [];

    const out: McpToolDescriptor[] = [];
    for (const entry of tools) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.name !== 'string' || record.name.length === 0) continue;
      out.push({
        name: record.name,
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
        inputSchema: (record.inputSchema ?? record.input_schema) as JsonValue | undefined,
      });
    }
    return out;
  }

  /** Invoke a tool by its server-local name. */
  async callTool(toolName: string, args: JsonValue): Promise<{ text: string; isError: boolean }> {
    const response = await this.transport.request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });
    if (response.error) {
      throw new McpTransportError(`tools/call '${toolName}' failed — ${describeJsonRpcError(response.error)}`);
    }
    const result = response.result;
    const content =
      typeof result === 'object' && result !== null && !Array.isArray(result)
        ? ((result as { content?: unknown }).content as Parameters<typeof flattenMcpContent>[0])
        : undefined;
    const isError =
      typeof result === 'object' && result !== null && (result as { isError?: unknown }).isError === true;
    return { text: flattenMcpContent(content), isError };
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

/**
 * Coerce a server-supplied schema into the JSON Schema subset the ToolEngine
 * validates.
 *
 * An MCP server is free to send a schema Camelia's validator does not understand.
 * Passing it through unchanged would make every call fail validation for reasons
 * the user cannot see, so anything unrecognised degrades to a permissive
 * `object` — the arguments are still checked for shape, just not for strict
 * properties.
 */
export function toToolSchema(raw: JsonValue | undefined): JsonSchema {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { type: 'object', properties: {} };
  }
  const record = raw as Record<string, unknown>;
  const properties =
    typeof record.properties === 'object' && record.properties !== null && !Array.isArray(record.properties)
      ? (record.properties as JsonSchema['properties'])
      : {};
  const required = Array.isArray(record.required)
    ? record.required.filter((entry): entry is string => typeof entry === 'string')
    : undefined;

  return {
    type: 'object',
    properties,
    ...(required && required.length > 0 ? { required } : {}),
  };
}

/**
 * Wrap one MCP tool as a native Camelia tool.
 *
 * The returned tool runs through {@link ToolResult} like any builtin, so the
 * executor's failure handling, retry classification and tracing all apply without
 * the adapter knowing they exist.
 */
export function wrapMcpTool(client: McpClient, descriptor: McpToolDescriptor): Tool<any, any> {
  const name = mcpToolName(client.name, descriptor.name);
  return {
    name,
    description:
      descriptor.description?.trim() ||
      `MCP tool '${descriptor.name}' from server '${client.name}'. No description provided by the server.`,
    schema: toToolSchema(descriptor.inputSchema),
    risk: mcpToolRisk(descriptor.name),
    // A server tool's effect is not journaled by Camelia, so the workspace
    // rollback that backs `fs.*` cannot undo it.
    reversible: false,
    // Forced: an MCP tool must never be auto-approved, however low its risk.
    approval: 'ask',
    async run(input: JsonValue, ctx: ToolContext): Promise<JsonValue> {
      const started = Date.now();
      ctx.logger.debug('mcp tool call', { tool: name, server: client.name });
      const result = await client.callTool(descriptor.name, input);
      return {
        text: result.text,
        // Preserve the server's own error flag as data. The tool call *reached*
        // the server successfully; the model's request was what failed, and
        // collapsing the two would make ErrorRecovery retry blindly.
        isError: result.isError,
        durationMs: Date.now() - started,
      };
    },
  };
}

export interface McpConnectResult {
  clients: McpClient[];
  tools: Array<{ server: string; tools: Tool<any, any>[] }>;
  statuses: McpServerStatus[];
}

/**
 * Connect to every enabled server in `configs`.
 *
 * Never throws for a server-level failure: each is captured in `statuses`. Only a
 * programming error (a transport factory that throws for all servers) surfaces.
 */
export async function connectAll(
  configs: readonly McpServerConfig[],
  options: McpClientOptions = {},
): Promise<McpConnectResult> {
  const { logger, createTransport = createMcpTransport } = options;
  const clients: McpClient[] = [];
  const tools: Array<{ server: string; tools: Tool<any, any>[] }> = [];
  const statuses: McpServerStatus[] = [];

  for (const config of configs) {
    if (config.disabled) {
      statuses.push({ name: config.name, transport: config.transport, ok: false, tools: [], disabled: true });
      continue;
    }

    const started = Date.now();
    let client: McpClient | undefined;
    try {
      client = new McpClient(config, createTransport(config), logger);
      const descriptors = await client.listTools();
      const wrapped = descriptors.map((descriptor) => wrapMcpTool(client as McpClient, descriptor));
      clients.push(client);
      tools.push({ server: config.name, tools: wrapped });
      statuses.push({
        name: config.name,
        transport: config.transport,
        ok: true,
        tools: wrapped.map((tool) => tool.name),
        handshakeMs: Date.now() - started,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Close the half-open transport: a client that failed mid-handshake may
      // still hold a child process alive.
      await client?.close().catch(() => undefined);
      logger?.warn('MCP server unavailable', { server: config.name, transport: config.transport, error: message });
      statuses.push({
        name: config.name,
        transport: config.transport,
        ok: false,
        tools: [],
        error: message,
        handshakeMs: Date.now() - started,
      });
    }
  }

  return { clients, tools, statuses };
}

/** Close every client, ignoring individual failures. */
export async function disconnectAll(clients: readonly McpClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
}

/** Re-exported so callers can distinguish transport faults from protocol faults. */
export { McpTransportError };
export type { ToolResult };