/**
 * MCP (Model Context Protocol) client contracts.
 *
 * Camelia is an MCP *client*: it connects to external MCP servers and wraps their
 * tools as ordinary Camelia tools, so they inherit the ToolEngine, the
 * ApprovalGate, the tracer and the workspace journal for free (whitepaper §8.5).
 *
 * The rule that shapes this file: **an MCP server is untrusted third-party code
 * that can hang, crash, lie or exfiltrate.** Every field here exists to bound
 * that. Timeouts are mandatory, tool names are namespaced, capabilities are
 * declared rather than assumed, and a malformed response is an error — never a
 * silent empty result that would let the agent conclude "the file does not exist".
 *
 * Two transports are supported, matching the protocol's own split: `stdio` (the
 * server is a child process we speak line-delimited JSON-RPC to) and `http`
 * (Streamable HTTP, one POST per request, optional SSE stream for notifications).
 * @module
 */

import type { JsonValue } from './common.js';
import type { RiskLevel } from './domain.js';


// ---------------------------------------------------------------------------
// JSON-RPC 2.0
// ---------------------------------------------------------------------------

/** JSON-RPC error codes we act on rather than treating as opaque text. */
export const JSONRPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: JsonValue;
  error?: JsonRpcError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow an unknown value to a JSON-RPC response envelope. */
export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isRecord(value) && value.jsonrpc === '2.0' && ('result' in value || 'error' in value);
}

/**
 * Render a JSON-RPC error as text.
 *
 * The message alone loses the code, and the code is what tells ErrorRecovery
 * whether a retry could ever help: `-32601` (unknown method) will fail identically
 * forever, while a transport-level failure is worth retrying.
 */
export function describeJsonRpcError(error: JsonRpcError): string {
  const named = Object.entries(JSONRPC_ERRORS).find(([, code]) => code === error.code);
  const label = named ? ` (${named[0]})` : '';
  return `MCP error ${error.code}${label}: ${error.message}`;
}

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

export const MCP_TRANSPORTS = ['stdio', 'http'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export interface McpStdioServerConfig {
  transport: 'stdio';
  /** Human-readable name; also the tool namespace and the `source` shown in the UI. */
  name: string;
  /** Executable to spawn, e.g. `npx` or `uvx`. */
  command: string;
  /** Arguments passed to the executable. */
  args: string[];
  /** Extra environment variables for the child process. */
  env?: Record<string, string>;
  /**
   * Milliseconds before a single request is abandoned.
   *
   * Mandatory and finite. A server that never answers must not be able to stall a
   * task forever — the agent would sit in a tool call with no way to report
   * progress and no way out.
   */
  timeoutMs: number;
  /** Skip registration of this server without deleting it from the file. */
  disabled?: boolean;
}

export interface McpHttpServerConfig {
  transport: 'http';
  name: string;
  url: string;
  /** Extra headers, e.g. `Authorization`. Values may come from `env`. */
  headers?: Record<string, string>;
  timeoutMs: number;
  disabled?: boolean;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpConfigIssue {
  /** Server name when it could be read before the failure. */
  server?: string;
  path: string;
  message: string;
}

export interface McpParseResult {
  servers: McpServerConfig[];
  issues: McpConfigIssue[];
}

/** Upper bound on a single MCP request. Beyond this the server is declared dead. */
export const MCP_MAX_TIMEOUT_MS = 120_000;
/** Floor. Below ~2s even a local stdio server has not finished booting. */
export const MCP_MIN_TIMEOUT_MS = 2_000;
export const MCP_DEFAULT_TIMEOUT_MS = 30_000;

/** A timeout outside the allowed band is clamped, and the clamp is reported. */
export function clampTimeout(raw: unknown): { value: number; clamped: boolean } {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : MCP_DEFAULT_TIMEOUT_MS;
  if (n < MCP_MIN_TIMEOUT_MS) return { value: MCP_MIN_TIMEOUT_MS, clamped: true };
  if (n > MCP_MAX_TIMEOUT_MS) return { value: MCP_MAX_TIMEOUT_MS, clamped: true };
  return { value: n, clamped: false };
}

/**
 * Validate `~/.camelia/mcp.json` into server configs.
 *
 * Shape follows the convention users already know from other MCP clients:
 * `{ "mcpServers": { "name": { "command": … } } }`.
 *
 * Rejection is per-server, never whole-file: one bad entry must not silently
 * disable every other server the user configured. Issues come back alongside the
 * valid servers so the caller can surface both.
 */
export function parseMcpConfig(raw: unknown): McpParseResult {
  const issues: McpConfigIssue[] = [];
  const servers: McpServerConfig[] = [];

  if (!isRecord(raw)) {
    return { servers, issues: [{ path: '', message: 'MCP config must be a JSON object' }] };
  }

  const section = raw.mcpServers ?? raw.servers;
  if (section === undefined) {
    // An empty file is a legitimate "no servers yet" state, not an error.
    return { servers, issues };
  }
  if (!isRecord(section)) {
    return { servers, issues: [{ path: 'mcpServers', message: 'mcpServers must be an object' }] };
  }

  for (const [name, value] of Object.entries(section)) {
    if (!isRecord(value)) {
      issues.push({ server: name, path: `mcpServers.${name}`, message: 'server entry must be an object' });
      continue;
    }

    const timeout = clampTimeout(value.timeoutMs);
    if (timeout.clamped) {
      issues.push({
        server: name,
        path: `mcpServers.${name}.timeoutMs`,
        message: `timeoutMs clamped to ${timeout.value}ms (allowed ${MCP_MIN_TIMEOUT_MS}–${MCP_MAX_TIMEOUT_MS})`,
      });
    }

    const disabled = value.disabled === true;

    // `url` present means HTTP regardless of what `transport` claims, so a
    // half-filled entry does not get spawned as a process.
    const looksHttp = typeof value.url === 'string' || value.transport === 'http';

    if (looksHttp) {
      if (typeof value.url !== 'string' || !value.url.trim()) {
        issues.push({ server: name, path: `mcpServers.${name}.url`, message: 'http server requires a url' });
        continue;
      }
      if (!/^https?:\/\//i.test(value.url)) {
        issues.push({ server: name, path: `mcpServers.${name}.url`, message: 'url must start with http:// or https://' });
        continue;
      }
      const headers: Record<string, string> = {};
      if (value.headers !== undefined) {
        if (!isRecord(value.headers)) {
          issues.push({ server: name, path: `mcpServers.${name}.headers`, message: 'headers must be an object' });
          continue;
        }
        for (const [key, headerValue] of Object.entries(value.headers)) {
          if (typeof headerValue !== 'string') {
            issues.push({
              server: name,
              path: `mcpServers.${name}.headers.${key}`,
              message: 'header value must be a string',
            });
            continue;
          }
          headers[key] = headerValue;
        }
      }
      servers.push({
        transport: 'http',
        name,
        url: value.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        timeoutMs: timeout.value,
        ...(disabled ? { disabled: true } : {}),
      });
      continue;
    }

    if (typeof value.command !== 'string' || !value.command.trim()) {
      issues.push({
        server: name,
        path: `mcpServers.${name}.command`,
        message: 'stdio server requires a command',
      });
      continue;
    }
    const args: string[] = [];
    if (value.args !== undefined) {
      if (!Array.isArray(value.args) || value.args.some((a) => typeof a !== 'string')) {
        issues.push({ server: name, path: `mcpServers.${name}.args`, message: 'args must be an array of strings' });
        continue;
      }
      args.push(...(value.args as string[]));
    }
    const env: Record<string, string> = {};
    if (value.env !== undefined) {
      if (!isRecord(value.env)) {
        issues.push({ server: name, path: `mcpServers.${name}.env`, message: 'env must be an object' });
        continue;
      }
      for (const [key, envValue] of Object.entries(value.env)) {
        if (typeof envValue !== 'string') {
          issues.push({ server: name, path: `mcpServers.${name}.env.${key}`, message: 'env value must be a string' });
          continue;
        }
        env[key] = envValue;
      }
    }

    servers.push({
      transport: 'stdio',
      name,
      command: value.command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      timeoutMs: timeout.value,
      ...(disabled ? { disabled: true } : {}),
    });
  }

  return { servers, issues };
}

// ---------------------------------------------------------------------------
// Protocol payloads
// ---------------------------------------------------------------------------

/** A tool as advertised by an MCP server during `tools/list`. */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: JsonValue;
}

/** The result of calling an MCP tool. Content blocks are flattened to text. */
export interface McpToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

/**
 * Flatten MCP content blocks into a single string for the model.
 *
 * Only `text` blocks carry content the model can reason over. Images and embedded
 * resources are named rather than inlined: the harness has no image channel, and
 * silently dropping a block would let the agent claim it "saw" the resource.
 */
export function flattenMcpContent(content: McpToolCallResult['content'] | undefined): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block?.type === 'string' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (typeof block?.type === 'string') {
      parts.push(`[${block.type} content omitted: Camelia passes text only]`);
    }
  }
  return parts.join('\n').trim();
}

/** Capabilities reported by an MCP server during `initialize`. */
export interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
}

/**
 * Namespace a remote tool name: `github` + `create_issue` -> `mcp.github.create_issue`.
 *
 * Namespacing is not cosmetic. Two servers may both expose `search`; without a
 * namespace the second registration would collide and the ToolEngine would throw
 * at startup, taking every server down with it.
 */
export function mcpToolName(server: string, tool: string): string {
  const safeServer = server.replace(/[^A-Za-z0-9_-]/g, '_');
  const safeTool = tool.replace(/[^A-Za-z0-9_-]/g, '_');
  return `mcp.${safeServer}.${safeTool}`;
}

/**
 * Risk assigned to a wrapped MCP tool.
 *
 * MCP servers are third-party code, so nothing they expose is auto-approved. The
 * caller pairs this with `approval: 'ask'`; this function exists to keep the risk
 * level honest for the UI and the permission display.
 *
 * The mapping is by tool *name* and therefore only a hint — which is exactly why
 * `approval` is forced to `'ask'` on the wrapper rather than derived from here.
 */
export function mcpToolRisk(toolName: string): RiskLevel {
  const lower = toolName.toLowerCase();
  if (/(delete|remove|destroy|drop|push|merge|send|post|commit)/.test(lower)) {
    return 'destructive';
  }
  if (/(write|create|update|install|exec|run)/.test(lower)) return 'write';
  if (/(fetch|http|request|upload|download)/.test(lower)) return 'network';
  return 'read-only';
}