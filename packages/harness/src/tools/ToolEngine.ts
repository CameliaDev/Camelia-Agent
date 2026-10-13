/**
 * Tool engine — registration, discovery, validation, guarded execution.
 * @module
 */

import type {
  JsonValue,
  LLMToolSchema,
  LoggerPort,
  MetricsPort,
  ToolDescriptor,
} from '@camelia/core';

import type { Tool, ToolContext, ToolResult } from './types.js';
import { isRetryableError } from './types.js';
import { formatIssues, validateSchema } from './schema-validator.js';

export interface RegisterOptions {
  /**
   * Where the tool came from — `'builtin'`, a plugin id, or an MCP server name.
   * Surfaced by `list()` so the UI can show the user who supplied a tool.
   */
  source?: string;
}

export class ToolEngine {
  private readonly tools = new Map<string, Tool<any, any>>();
  private readonly sources = new Map<string, string>();

  constructor(
    private readonly logger?: LoggerPort,
    private readonly metrics?: MetricsPort,
  ) {}

  register(tool: Tool<any, any>, options: RegisterOptions = {}): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    this.sources.set(tool.name, options.source ?? 'builtin');
  }

  registerAll(tools: Tool<any, any>[], options: RegisterOptions = {}): void {
    for (const tool of tools) this.register(tool, options);
  }

  /** Origin of a registered tool (`builtin`, plugin id, or MCP server name). */
  sourceOf(name: string): string | undefined {
    return this.sources.get(name);
  }

  get(name: string): Tool<any, any> | undefined {
    return this.tools.get(name);
  }

  /**
   * Usage layer (Iteration 20 — three-layer tool knowledge).
   *
   * Returns the concrete usage doc (commands, flags, examples) for a tool, or
   * undefined when the tool defines none. This never enters the resident tool
   * list — callers inject it on demand (e.g. after a failed call).
   */
  usageOf(name: string): string | undefined {
    return this.tools.get(name)?.usage;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      risk: tool.risk,
      reversible: tool.reversible,
      source: this.sources.get(tool.name) ?? 'builtin',
    }));
  }

  /** Schemas in the shape the LLM port expects. Optionally restricted to a subset. */
  schemas(allowed?: string[]): LLMToolSchema[] {
    // ['*'] means every registered tool (coder preset). Treat it as unrestricted.
    const tools =
      !allowed || allowed.includes('*')
        ? [...this.tools.values()]
        : allowed.map((name) => this.tools.get(name)).filter((t): t is Tool<any, any> => Boolean(t));
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    }));
  }

  /**
   * Validate and run a tool.
   *
   * Never throws for expected failures: schema violations and tool errors come
   * back as `{ ok: false }` so the executor can feed them to the model.
   */
  async invoke(name: string, input: JsonValue, ctx: ToolContext): Promise<ToolResult> {
    const startedAt = ctx.clock.now();
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        error: `Unknown tool "${name}". Available: ${[...this.tools.keys()].join(', ')}`,
        retryable: false,
        durationMs: 0,
      };
    }

    const issues = validateSchema(tool.schema, input);
    if (issues.length > 0) {
      this.metrics?.inc('tool.schema_reject', { tool: name });
      return {
        ok: false,
        error: `Invalid arguments for ${name}: ${formatIssues(issues)}`,
        retryable: true,
        durationMs: ctx.clock.now() - startedAt,
      };
    }

    this.metrics?.inc('tool.invocations', { tool: name });
    try {
      const output = (await tool.run(input, ctx)) as JsonValue;
      const durationMs = ctx.clock.now() - startedAt;
      this.metrics?.observe('tool.latency_ms', durationMs, { tool: name });
      return { ok: true, output, durationMs };
    } catch (error) {
      const durationMs = ctx.clock.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      this.metrics?.inc('tool.error', { tool: name });
      this.logger?.warn('tool failed', { tool: name, error: message });
      return { ok: false, error: message, retryable: isRetryableError(message), durationMs };
    }
  }
}