/**
 * `camelia doctor` — prove the installation before a task is at risk.
 *
 * Answers three questions in order: is the home directory sane, which providers
 * are usable, and does the engine actually complete a task. The third is the one
 * that matters — a provider list is a claim, a completed run is evidence
 * (whitepaper §9.1: verify, do not assume).
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CameliaRuntime, MockProvider, loadConfig, loadMcpServers, mockDemoSpec, paths, scriptedTaskScript, usableProfiles, type ProviderHandle } from '@camelia/agent';

import type { ParsedArgs } from '../args.js';
import { createTheme, resolveColour } from '../theme.js';
import { EXIT } from './run.js';

export async function doctorCommand(args: ParsedArgs): Promise<number> {
  const colour = resolveColour(args.flags.has('no-color') ? 'never' : args.flags.has('color') ? 'always' : 'auto');
  const theme = createTheme(colour);
  const out = (text: string): void => void process.stdout.write(text);

  out(`\n${theme.accentBold('Camelia doctor')}\n\n`);

  // ---- 1. home directory ---------------------------------------------------
  const home = paths.home();
  const files: { label: string; file: string }[] = [
    { label: 'config', file: paths.config() },
    { label: 'keys', file: paths.keys() },
    { label: 'database', file: paths.database() },
  ];
  out(theme.dim('  home') + `  ${theme.text(home)}\n`);
  for (const entry of files) {
    const present = fs.existsSync(entry.file);
    out(
      `    ${present ? theme.green('\u2713') : theme.dim('\u00b7')} ${theme.dim(entry.label.padEnd(9))} ${theme.grey(entry.file)} ${present ? '' : theme.dim('(absent)')}\n`,
    );
  }
  out('\n');

  // ---- 2. providers --------------------------------------------------------
  const config = loadConfig();
  const usable = usableProfiles(config);
  const usableIds = new Set(usable.map((p) => p.id));

  out(theme.dim('  providers') + `  ${theme.text(`${usable.length} usable / ${config.providers.length} configured`)}\n`);
  for (const profile of config.providers) {
    const ok = usableIds.has(profile.id);
    const mark = ok ? theme.green('\u2713') : theme.dim('\u2717');
    const keyNote =
      profile.kind === 'mock'
        ? 'scripted'
        : profile.id === 'ollama'
          ? 'keyless'
          : profile.apiKey
            ? 'key resolved'
            : 'no key';
    out(
      `    ${mark} ${theme.text(profile.id.padEnd(14))} ${theme.dim(profile.label.padEnd(16))} ${theme.grey(keyNote.padEnd(13))} ${theme.dim(profile.defaultModel ?? '')}\n`,
    );
  }
  out('\n');

  // ---- 2b. MCP servers -----------------------------------------------------
  // MCP is opt-in, so "no file" is a normal state rather than a problem. What
  // matters is that a configured server is *reachable* — an unreachable server
  // silently contributes no tools, which looks to the user like a broken agent.
  const mcpFile = paths.mcp();
  const mcp = loadMcpServers();
  out(
    theme.dim('  mcp servers') +
      `  ${theme.text(mcp.servers.length === 0 ? 'none configured' : `${mcp.servers.length} configured`)}` +
      (mcp.servers.length === 0 ? theme.dim(`  ${mcpFile}`) : '') +
      '\n',
  );
  for (const issue of mcp.issues) {
    out(`    ${theme.amber('!')} ${theme.text((issue.server ?? issue.path).padEnd(14))} ${theme.grey(issue.message)}\n`);
  }
  if (mcp.servers.length > 0) {
    const runtime = await CameliaRuntime.create({
      workspace: fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-doctor-mcp-')),
      databaseFile: ':memory:',
      logLevel: 'error',
      logTo: () => undefined,
      mcpServers: mcp.servers,
    });
    try {
      for (const status of runtime.mcp) {
        if (status.disabled) {
          out(`    ${theme.dim('\u00b7')} ${theme.text(status.name.padEnd(14))} ${theme.dim('disabled')}\n`);
          continue;
        }
        const mark = status.ok ? theme.green('\u2713') : theme.red('\u2717');
        const note = status.ok
          ? `${status.tools.length} tool(s) in ${status.handshakeMs}ms`
          : (status.error ?? 'unavailable');
        out(
          `    ${mark} ${theme.text(status.name.padEnd(14))} ${theme.dim(status.transport.padEnd(7))} ${theme.grey(note)}\n`,
        );
        for (const tool of status.tools) out(`      ${theme.green('\u00b7')} ${theme.dim(tool)}\n`);
      }
    } finally {
      await runtime.close();
    }
  }
  out('\n');

  const wantsSelfTest = args.flags.has('offline') || args.flags.has('mock');
  if (!wantsSelfTest) {
    out(theme.dim('  run `camelia doctor --offline` to exercise the full pipeline with the scripted provider.') + '\n\n');
    return EXIT.done;
  }

  // ---- 3. engine self-test -------------------------------------------------
  out(theme.dim('  self-test') + `  ${theme.text('scripted provider, isolated workspace')}\n`);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-doctor-'));
  const port = new MockProvider({ id: 'mock', models: ['scripted'], script: scriptedTaskScript(mockDemoSpec('doctor self-test')) });
  const handle: ProviderHandle = { id: 'mock', label: 'Scripted mock', model: 'scripted', models: ['scripted'], port };

  const runtime = await CameliaRuntime.create({
    workspace,
    providerHandles: [handle],
    autoApprove: true,
    databaseFile: ':memory:',
    logLevel: 'error',
    logTo: () => undefined,
  });

  try {
    const result = await runtime.run('doctor self-test', { offlineClarify: true });
    const produced = fs.readdirSync(workspace);
    const ok = result.outcome.status === 'done' && produced.length > 0;
    out(
      `    ${ok ? theme.green('\u2713') : theme.red('\u2717')} ${theme.text(`pipeline ${result.outcome.status}`)} ` +
        theme.dim(
          `${result.outcome.stepsCompleted}/${result.outcome.stepsTotal} steps ${'\u00b7'} ${result.outcome.iterations} iteration(s) ${'\u00b7'} ${produced.length} file(s) written`,
        ) +
        '\n',
    );
    for (const file of produced) out(`      ${theme.green('\u00b7')} ${theme.text(file)}\n`);
    out('\n');
    return ok ? EXIT.done : EXIT.failed;
  } finally {
    await runtime.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}