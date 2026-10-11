/**
 * `camelia serve` — run the engine as a local server the desktop UI attaches to.
 *
 * This is the bridge between Phase 1 (engine, no UI) and Phase 3 (UI, no engine):
 * the same runtime, the same event bus, now reachable over SSE. It stays in the
 * foreground until interrupted, printing the one URL the shell needs.
 *
 * Approval policy note: with a UI attached, the *UI* is the approver, so the broker
 * is wired as the responder and gates wait for `approve_tool` / `deny_tool`. `--yes`
 * bypasses that for unattended automation.
 * @module
 */

import path from 'node:path';

import {
  CameliaRuntime,
  MockProvider,
  autoApprover,
  mockDemoSpec,
  scriptedTaskScript,
  type ProviderHandle,
  type ScriptedTaskSpec,
} from '@camelia/agent';

import { ArgError, option, type ParsedArgs } from '../args.js';
import { ApprovalBroker } from '../server/ApprovalBroker.js';
import { EngineServer } from '../server/EngineServer.js';
import { createTheme, resolveColour } from '../theme.js';
import { SLOGAN, VERSION } from '../version.js';
import { loadSpecFile } from './run.js';

export interface ServeCommandOptions {
  /**
   * Resolves when the server should stop. Defaults to the process's `SIGINT`/`SIGTERM`;
   * tests pass a controllable promise so the command can be driven in-process without
   * signalling the test runner itself.
   */
  stop?: Promise<void>;
}

export async function serveCommand(args: ParsedArgs, options: ServeCommandOptions = {}): Promise<number> {
  const json = args.flags.has('json');
  const colour = resolveColour(args.flags.has('no-color') ? 'never' : 'auto') && !json;
  const theme = createTheme(colour);
  const out = (text: string): void => void process.stdout.write(text);

  const workspace = path.resolve(option(args, 'workspace', process.cwd())!);
  const host = option(args, 'host', '127.0.0.1')!;
  const port = Number(option(args, 'port', '7433'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ArgError(`invalid --port: ${option(args, 'port')}`);

  const mock = args.flags.has('mock') || args.options.has('spec');
  const autoApprove = args.flags.has('yes');
  const timeoutSec = Number(option(args, 'approval-timeout', '300'));
  const autoRun = option(args, 'auto-run');
  const offlineClarify = mock || args.flags.has('offline');

  const spec: ScriptedTaskSpec | undefined = loadSpecFile(args);
  const providerHandles: ProviderHandle[] | undefined = mock ? [scriptedHandle(spec, autoRun)] : undefined;

  const broker = new ApprovalBroker({ timeoutMs: Math.max(1, timeoutSec) * 1_000 });

  const runtime = await CameliaRuntime.create({
    workspace,
    ...(providerHandles ? { providerHandles } : {}),
    ...(option(args, 'provider') ? { preferredProvider: option(args, 'provider')! } : {}),
    ...(option(args, 'model') ? { model: option(args, 'model')! } : {}),
    ...(option(args, 'grunt-model') ? { gruntModel: option(args, 'grunt-model')! } : {}),
    ...(option(args, 'db') ? { databaseFile: option(args, 'db')! } : {}),
    ...(option(args, 'test-command') ? { testCommand: option(args, 'test-command')! } : {}),
    approvalResponder: autoApprove ? autoApprover() : broker.responder(),
    planApproval: autoApprove || args.flags.has('auto-approve-plan') ? 'auto' : 'always',
    logLevel: (option(args, 'log-level', 'warn') as 'debug' | 'info' | 'warn' | 'error') ?? 'warn',
    logTo: (line) => void process.stderr.write(line),
  });

  const server = new EngineServer({
    runtime,
    broker,
    host,
    port,
    offlineClarify,
    ...(autoRun ? { autoRun } : {}),
    ...(option(args, 'origins') ? { allowedOrigins: option(args, 'origins')!.split(',') } : {}),
  });

  const address = await server.start();

  if (json) {
    out(`${JSON.stringify({ url: address.url, sessionId: runtime.session.id, provider: runtime.session.provider }, null, 2)}\n`);
  } else {
    printBanner(address.url, runtime.session.id, runtime.providerChain().length, theme, out);
  }

  return await waitForShutdown(async () => {
    await server.stop();
    await runtime.close();
  }, options.stop);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Resolve when the user interrupts (or `externalStop` fires), after running `cleanup` once. */
function waitForShutdown(cleanup: () => Promise<void>, externalStop?: Promise<void>): Promise<number> {
  return new Promise<number>((resolve) => {
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      void cleanup().finally(() => resolve(code));
    };
    const onSignal = (): void => finish(0);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    if (externalStop) void externalStop.then(() => finish(0));
  });
}

function scriptedHandle(spec: ScriptedTaskSpec | undefined, intent: string | undefined): ProviderHandle {
  const script = scriptedTaskScript(spec ?? mockDemoSpec(intent ?? 'serve demo'));
  const port = new MockProvider({ id: 'mock', models: ['scripted'], script });
  return { id: 'mock', label: 'Scripted mock', model: 'scripted', models: ['scripted'], port };
}

function printBanner(
  url: string,
  sessionId: string,
  providers: number,
  theme: ReturnType<typeof createTheme>,
  write: (text: string) => void,
): void {
  write(
    [
      '',
      `${theme.accentBold('Camelia')} ${theme.dim(VERSION)} ${theme.dim('\u00b7')} ${theme.grey(SLOGAN)}`,
      '',
      `  ${theme.dim('engine')}   ${theme.text(url)}`,
      `  ${theme.dim('session')}  ${theme.text(sessionId)}`,
      `  ${theme.dim('chain')}    ${theme.text(`${providers} provider(s)`)}`,
      '',
      `  ${theme.grey('attach the desktop UI with --engine-url')} ${theme.text(url)}`,
      `  ${theme.grey('stop with Ctrl+C')}`,
      '',
    ].join('\n') + '\n',
  );
}