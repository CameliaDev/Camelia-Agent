/**
 * `camelia run "<intent>"` — drive one task end to end without a UI.
 *
 * This is the Phase 1 acceptance surface (whitepaper §7): if a real coding task can
 * be completed here, the engine works; if it cannot, no amount of UI will save it.
 *
 * Two modes:
 *   • live   — the provider fallback chain (OpenCode Zen → OpenRouter → Ollama);
 *   • `--mock` — the scripted provider, which exercises the *entire* pipeline
 *     (clarify → plan → execute → verify → persist → deliver) with zero quota.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  CameliaRuntime,
  MockProvider,
  mockDemoSpec,
  scriptedTaskScript,
  paths,
  type CameliaRunResult,
  type ProviderHandle,
  type ScriptedTaskSpec,
} from '@camelia/agent';
import type { LogLevel } from '@camelia/core';

import { ArgError, option, type ParsedArgs } from '../args.js';
import { EventRenderer } from '../render.js';
import { createTheme, resolveColour } from '../theme.js';
import { SLOGAN, VERSION } from '../version.js';

/** Exit codes are part of the CLI contract — scripts depend on them. */
export const EXIT = {
  done: 0,
  failed: 1,
  usage: 2,
  paused: 3,
  cancelled: 130,
} as const;

export async function runCommand(args: ParsedArgs): Promise<number> {
  const resumeTaskId = option(args, 'resume');
  const intent = args.positionals.slice(1).join(' ').trim();
  if (!intent && !resumeTaskId) throw new ArgError('usage: camelia run "<task>" | camelia run --resume <taskId>');

  const json = args.flags.has('json');
  const quiet = args.flags.has('quiet');
  const verbose = args.flags.has('verbose');
  const autoApprove = args.flags.has('yes');
  const mock = args.flags.has('mock') || args.options.has('spec');
  const colourMode = args.flags.has('no-color') ? 'never' : args.flags.has('color') ? 'always' : 'auto';
  const colour = resolveColour(colourMode) && !json;
  const theme = createTheme(colour);

  const workspace = path.resolve(option(args, 'workspace', process.cwd())!);
  if (!fs.existsSync(workspace)) throw new ArgError(`workspace does not exist: ${workspace}`);

  const logLevel = (option(args, 'log-level', verbose ? 'debug' : 'warn') as LogLevel) ?? 'warn';

  const spec = loadSpecFile(args);
  const providerHandles = mock ? [scriptedHandle(intent, spec)] : undefined;

  const out = (text: string): void => void process.stdout.write(text);
  if (!json && !quiet) printHeader(workspace, intent || `resume ${resumeTaskId}`, theme, out);

  const runtime = await CameliaRuntime.create({
    workspace,
    ...(providerHandles ? { providerHandles } : {}),
    ...(option(args, 'provider') ? { preferredProvider: option(args, 'provider')! } : {}),
    ...(option(args, 'model') ? { model: option(args, 'model')! } : {}),
    ...(option(args, 'grunt-model') ? { gruntModel: option(args, 'grunt-model')! } : {}),
    ...(option(args, 'db') ? { databaseFile: option(args, 'db')! } : {}),
    ...(option(args, 'test-command') ? { testCommand: option(args, 'test-command')! } : {}),
    profileDir: paths.profiles(),
    runRecordDir: paths.runs(),
    autoApprove,
    planApproval: autoApprove || args.flags.has('auto-approve-plan') ? 'auto' : 'always',
    logLevel,
    logTo: (line) => void process.stderr.write(line),
  });

  const renderer = json
    ? undefined
    : new EventRenderer(runtime.bus, { theme, write: out, quiet, verbose });
  const detach = renderer?.attach();

  if (!json && !quiet) {
    out(theme.dim(`  session ${runtime.session.id} ${'\u00b7'} ${runtime.providerChain().length} provider(s) in chain`) + '\n');
    out('\n');
  }

  let result: CameliaRunResult;
  try {
    result = await runtime.run(intent, {
      offlineClarify: mock,
      ...(resumeTaskId ? { resumeTaskId } : {}),
    });
  } finally {
    detach?.();
    await runtime.close();
  }

  if (json) {
    out(`${JSON.stringify(toJson(result), null, 2)}\n`);
  } else {
    printOutcome(result, theme, quiet);
  }

  return exitCodeFor(result);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Read a `--spec <file.json>` scripted task. Exported so `camelia serve` can drive the
 * same scripted provider the `run` command does — one script format, two entry points.
 */
export function loadSpecFile(args: ParsedArgs): ScriptedTaskSpec | undefined {
  const specPath = option(args, 'spec');
  if (!specPath) return undefined;
  const abs = path.resolve(specPath);
  if (!fs.existsSync(abs)) throw new ArgError(`spec file not found: ${abs}`);
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8')) as ScriptedTaskSpec;
  } catch (error) {
    throw new ArgError(`spec file is not valid JSON: ${abs} (${String(error)})`);
  }
}

function scriptedHandle(intent: string, spec: ScriptedTaskSpec | undefined): ProviderHandle {
  const script = scriptedTaskScript(spec ?? mockDemoSpec(intent));
  const port = new MockProvider({ id: 'mock', models: ['scripted'], script });
  return { id: 'mock', label: 'Scripted mock', model: 'scripted', models: ['scripted'], port };
}

function printHeader(
  workspace: string,
  intent: string,
  theme: ReturnType<typeof createTheme>,
  write: (text: string) => void,
): void {
  write(
    [
      '',
      `${theme.accentBold('Camelia')} ${theme.dim(VERSION)} ${theme.dim('\u00b7')} ${theme.grey(SLOGAN)}`,
      '',
      `  ${theme.dim('workspace')}  ${theme.text(workspace)}`,
      `  ${theme.dim('task')}       ${theme.text(intent)}`,
      '',
    ].join('\n') + '\n',
  );
}

function printOutcome(result: CameliaRunResult, theme: ReturnType<typeof createTheme>, quiet: boolean): void {
  const { outcome, provider } = result;
  const out = (text: string): void => void process.stdout.write(text);

  if (!quiet) {
    out('\n');
    out(theme.dim(`  provider ${provider.id} ${'\u00b7'} model ${provider.model} ${'\u00b7'} grunt ${provider.gruntModel}`) + '\n');
    out(
      theme.dim(
        `  tokens ${result.budget.used}/${result.budget.window} (${Math.round((result.budget.used / Math.max(1, result.budget.window)) * 100)}%) ${'\u00b7'} ${result.metrics.length} metric(s)`,
      ) + '\n',
    );
    out('\n');
  }

  const badge =
    outcome.status === 'done'
      ? theme.green('\u2713 done')
      : outcome.status === 'failed'
        ? theme.red('\u2717 failed')
        : outcome.status === 'paused'
          ? theme.amber('\u0021 paused')
          : theme.red('\u2717 cancelled');

  out(
    `${badge}  ${theme.text(`${outcome.stepsCompleted}/${outcome.stepsTotal} steps`)} ${theme.dim('\u00b7')} ` +
      `${theme.text(`${outcome.iterations} iteration(s)`)} ${theme.dim('\u00b7')} ` +
      `${theme.text(`${outcome.tokensUsed} tokens`)} ${theme.dim('\u00b7')} ` +
      `${theme.text(`${(outcome.durationMs / 1000).toFixed(1)}s`)}\n`,
  );

  if (outcome.unverifiedSteps > 0) {
    out(theme.amber(`  ${outcome.unverifiedSteps} step(s) completed without objective verification`) + '\n');
  }
  if (outcome.reason) out(theme.dim(`  ${outcome.reason}`) + '\n');

  const artifacts = deliveredFiles(outcome.artifacts);
  if (artifacts.length > 0) {
    out('\n' + theme.dim('  artifacts') + '\n');
    for (const artifact of artifacts) out(`    ${theme.green('\u00b7')} ${theme.text(artifact)}\n`);
  }

  if (outcome.status === 'paused' && outcome.resumeStepIdx !== undefined) {
    out('\n' + theme.amber(`  resume from step ${outcome.resumeStepIdx + 1} with: camelia run --resume ${outcome.taskId}`) + '\n');
  }
  out('\n');
}

/** Machine-readable projection — stable keys, no ANSI, no internal handles. */
function toJson(result: CameliaRunResult): Record<string, unknown> {
  const { outcome } = result;
  return {
    taskId: outcome.taskId,
    sessionId: result.session.id,
    status: outcome.status,
    summary: outcome.summary,
    steps: {
      completed: outcome.stepsCompleted,
      total: outcome.stepsTotal,
      unverified: outcome.unverifiedSteps,
    },
    iterations: outcome.iterations,
    tokensUsed: outcome.tokensUsed,
    durationMs: outcome.durationMs,
    reason: outcome.reason ?? null,
    resumeStepIdx: outcome.resumeStepIdx ?? null,
    intent: result.intent,
    provider: result.provider,
    budget: result.budget,
    context: result.context,
    artifacts: deliveredFiles(outcome.artifacts),
    verdicts: outcome.verdicts.map((v) => ({ stepId: v.stepId, status: v.status, reason: v.reason })),
    metrics: result.metrics,
    eventCount: result.events.length,
  };
}

/**
 * The deliverables a user can actually open: file and diff artifacts.
 *
 * `stdout` artifacts (e.g. `shell.exec:node --version`) are evidence of work, not
 * files — listing them under "artifacts" would overstate what was produced.
 */
function deliveredFiles(artifacts: CameliaRunResult['outcome']['artifacts']): string[] {
  return [
    ...new Set(
      artifacts.filter((a) => a.kind === 'file' || a.kind === 'diff').map((a) => a.path),
    ),
  ];
}

function exitCodeFor(result: CameliaRunResult): number {
  switch (result.outcome.status) {
    case 'done':
      return EXIT.done;
    case 'failed':
      return EXIT.failed;
    case 'paused':
      return EXIT.paused;
    case 'cancelled':
      return EXIT.cancelled;
    default:
      return EXIT.failed;
  }
}