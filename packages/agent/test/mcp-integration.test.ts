/**
 * MCP integration — an external server's tools inside the real composition root.
 *
 * `mcp.test.ts` proves the protocol and the transport. This suite proves the part
 * that actually decides whether MCP is useful: that a remote tool becomes a
 * first-class Camelia tool that the ToolEngine can list, the tracer can attribute
 * and the ApprovalGate can block.
 *
 * The behaviours that matter architecturally:
 *
 * - an unreachable server degrades the *tool set*, not the task
 * - MCP tools are attributed to their server, so the UI can say who supplied them
 * - `autoApprove` cannot wave an MCP tool through — third-party code always asks
 *
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { McpServerConfig } from '@camelia/core';
import type { McpTransport } from '@camelia/harness';
import { CameliaRuntime } from '../src/runtime/CameliaRuntime.js';
import type { ProviderHandle } from '../src/ProviderRegistry.js';
import { MockProvider } from '../src/providers/MockProvider.js';
import { scriptedTaskScript, type ScriptedTaskSpec } from '../src/providers/ScriptedAgentProvider.js';
import { mockDemoSpec } from '../src/providers/ScriptedAgentProvider.js';

/**
 * Fixture MCP server: answers the handshake, advertises one read-only tool.
 * Runs as a real child process so the stdio path is exercised end to end.
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
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }) + '\\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [
        { name: 'read_note', description: 'Read a note by id', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
        { name: 'delete_everything', description: 'Destructive demo tool', inputSchema: { type: 'object', properties: {} } }
      ] } }) + '\\n');
    } else if (msg.method === 'tools/call') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'note:' + msg.params.arguments.id }] } }) + '\\n');
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\\n');
    }
  }
});
`;

const runtimes: CameliaRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.close().catch(() => undefined)));
  vi.unstubAllEnvs();
});

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function handle(spec: ScriptedTaskSpec): ProviderHandle {
  const port = new MockProvider({ id: 'mock', models: ['scripted'], script: scriptedTaskScript(spec) });
  return { id: 'mock', label: 'Scripted mock', model: 'scripted', models: ['scripted'], port };
}

const fixtureServer: McpServerConfig = {
  transport: 'stdio',
  name: 'notes',
  command: process.execPath,
  args: ['-e', SERVER_SOURCE],
  timeoutMs: 8_000,
};

async function createRuntime(overrides: Partial<Parameters<typeof CameliaRuntime.create>[0]> = {}): Promise<CameliaRuntime> {
  const runtime = await CameliaRuntime.create({
    workspace: tempDir('camelia-mcp-ws-'),
    providerHandles: [handle(mockDemoSpec('mcp integration'))],
    databaseFile: ':memory:',
    autoApprove: true,
    logLevel: 'error',
    logTo: () => undefined,
    ...overrides,
  });
  runtimes.push(runtime);
  return runtime;
}

describe('MCP in the composition root', () => {
  it('registers a live server\'s tools and attributes them to that server', async () => {
    const runtime = await createRuntime({ mcpServers: [fixtureServer] });

    const status = runtime.mcp.find((entry) => entry.name === 'notes');
    expect(status?.ok).toBe(true);
    expect(status?.tools.sort()).toEqual(['mcp.notes.delete_everything', 'mcp.notes.read_note']);

    // The UI must be able to answer "who supplied this tool?".
    expect(runtime.tools.sourceOf('mcp.notes.read_note')).toBe('mcp:notes');
    expect(runtime.tools.has('mcp.notes.read_note')).toBe(true);

    const descriptor = runtime.tools.list().find((tool) => tool.name === 'mcp.notes.read_note');
    expect(descriptor?.description).toBe('Read a note by id');
    expect(descriptor?.schema.required).toEqual(['id']);
  });

  it('marks a destructive-looking MCP tool as destructive but still asks first', async () => {
    const runtime = await createRuntime({ mcpServers: [fixtureServer] });
    const tool = runtime.tools.get('mcp.notes.delete_everything');

    expect(tool?.risk).toBe('destructive');
    // Risk informs the display; approval is what actually gates execution.
    expect(tool?.approval).toBe('ask');
    expect(tool?.reversible).toBe(false);
  });

  it('runs an MCP tool end to end and returns its content', async () => {
    const runtime = await createRuntime({ mcpServers: [fixtureServer] });
    const tool = runtime.tools.get('mcp.notes.read_note')!;

    const output = (await tool.run({ id: '42' }, {
      workspace: runtime.workspace,
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      clock: { now: () => Date.now() },
      signal: new AbortController().signal,
    } as never)) as { text: string; isError: boolean };

    expect(output.text).toBe('note:42');
    expect(output.isError).toBe(false);
  });

  it('completes a real task with an MCP server attached', async () => {
    const runtime = await createRuntime({ mcpServers: [fixtureServer] });
    const result = await runtime.run('complete the task');

    // The point of the exercise: adding a server must not disturb the pipeline.
    expect(result.outcome.status).toBe('done');
    expect(result.outcome.unverifiedSteps).toBe(0);
  });

  it('completes the same task when the MCP server is unreachable', async () => {
    const runtime = await createRuntime({
      mcpServers: [{ transport: 'stdio', name: 'ghost', command: 'camelia-no-such-binary-xyz', args: [], timeoutMs: 3_000 }],
    });

    const status = runtime.mcp.find((entry) => entry.name === 'ghost');
    expect(status?.ok).toBe(false);
    expect(status?.error).toBeTruthy();
    expect(runtime.tools.has('mcp.ghost.read_note')).toBe(false);

    // MCP extends capability; it is not a dependency. An unreachable optional
    // server must not stop a task the user asked for.
    const result = await runtime.run('complete the task');
    expect(result.outcome.status).toBe('done');
  });

  it('keeps working servers when a sibling server fails', async () => {
    const runtime = await createRuntime({
      mcpServers: [
        { transport: 'stdio', name: 'ghost', command: 'camelia-no-such-binary-xyz', args: [], timeoutMs: 3_000 },
        fixtureServer,
      ],
    });

    expect(runtime.mcp.map((entry) => entry.ok)).toEqual([false, true]);
    // One bad entry must not disable the servers configured correctly.
    expect(runtime.tools.has('mcp.notes.read_note')).toBe(true);
  });

  it('never contacts a disabled server', async () => {
    let built = 0;
    // The explicit return type matters: a body that only throws would otherwise
    // infer `never` and silently satisfy any signature.
    const factory = (config: McpServerConfig): McpTransport => {
      built += 1;
      throw new Error(`transport built for disabled server ${config.name}`);
    };
    const runtime = await createRuntime({
      mcpServers: [{ ...fixtureServer, disabled: true }],
      mcpTransportFactory: factory,
    });

    expect(built).toBe(0);
    expect(runtime.mcp[0]).toMatchObject({ name: 'notes', disabled: true });
  });

  it('starts no MCP connection when none is configured', async () => {
    let built = 0;
    const factory = (): McpTransport => {
      built += 1;
      throw new Error('transport built with no servers configured');
    };
    const runtime = await createRuntime({ mcpTransportFactory: factory });

    expect(built).toBe(0);
    expect(runtime.mcp).toEqual([]);
  });

  it('closes MCP connections when the runtime closes', async () => {
    const close = vi.fn(() => Promise.resolve());
    const runtime = await CameliaRuntime.create({
      workspace: tempDir('camelia-mcp-close-'),
      providerHandles: [handle(mockDemoSpec('mcp close'))],
      databaseFile: ':memory:',
      autoApprove: true,
      logLevel: 'error',
      logTo: () => undefined,
      mcpServers: [fixtureServer],
      mcpTransportFactory: () => ({
        serverName: 'notes',
        request: (payload: unknown) => {
          const msg = payload as { id: number | string; method: string };
          if (msg.method === 'initialize') return Promise.resolve({ jsonrpc: '2.0' as const, id: msg.id, result: {} });
          if (msg.method === 'tools/list') {
            return Promise.resolve({ jsonrpc: '2.0' as const, id: msg.id, result: { tools: [{ name: 'read_note' }] } });
          }
          return Promise.resolve({ jsonrpc: '2.0' as const, id: msg.id, result: {} });
        },
        close,
      }),
    });

    await runtime.close();
    // A leaked stdio child per run would accumulate across a long session.
    expect(close).toHaveBeenCalledTimes(1);
  });
});