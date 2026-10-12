/**
 * `loadMcpServers` — fail-soft MCP config loading (Iteration 26 — Stage 1).
 *
 * A missing file is normal (opt-in feature); a malformed file yields the issue
 * instead of throwing, so the rest of the engine keeps working. Asserted
 * directly in the agent package.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadMcpServers } from '../src/config/load.js';

describe('loadMcpServers', () => {
  it('treats a missing file as "no servers", not an error', () => {
    const missing = path.join(os.tmpdir(), `camelia-mcp-${Date.now()}-missing.json`);
    const result = loadMcpServers(missing);
    expect(result).toEqual({ servers: [], issues: [] });
  });

  it('parses a valid mcp.json into server definitions', () => {
    const file = path.join(os.tmpdir(), `camelia-mcp-${Date.now()}-ok.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          playwright: { command: 'npx', args: ['@playwright/mcp@latest'], env: {} },
          fs: { transport: 'stdio', command: 'camelia-mcp-fs' },
        },
      }),
      'utf8',
    );
    const result = loadMcpServers(file);
    expect(result.issues).toEqual([]);
    expect(result.servers.map((s) => s.name)).toEqual(['playwright', 'fs']);
    fs.rmSync(file, { force: true });
  });

  it('reports a malformed file as an issue instead of throwing', () => {
    const file = path.join(os.tmpdir(), `camelia-mcp-${Date.now()}-bad.json`);
    fs.writeFileSync(file, '{not json', 'utf8');
    const result = loadMcpServers(file);
    expect(result.servers).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toBe(file);
    expect(result.issues[0]?.message).toContain('invalid JSON');
    fs.rmSync(file, { force: true });
  });
});
