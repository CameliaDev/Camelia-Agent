#!/usr/bin/env node
/**
 * `camelia` — command line entry point.
 *
 * A thin dispatcher: parse, route, translate the returned exit code. All real work
 * lives in `commands/*` so it can be unit-tested without spawning a process
 * (whitepaper §7, "CLI 验证").
 * @module
 */

import { ArgError, parseArgs } from './args.js';
import { doctorCommand } from './commands/doctor.js';
import { replayCommand } from './commands/replay.js';
import { EXIT, runCommand } from './commands/run.js';
import { serveCommand } from './commands/serve.js';
import { createTheme, resolveColour } from './theme.js';
import { SLOGAN, VERSION } from './version.js';

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const command = args.positionals[0];

  if (args.flags.has('version') || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return EXIT.done;
  }
  if (args.flags.has('help') || command === undefined || command === 'help') {
    printHelp();
    return EXIT.done;
  }

  switch (command) {
    case 'run':
      return runCommand(args);
    case 'serve':
      return serveCommand(args);
    case 'doctor':
      return doctorCommand(args);
    case 'replay':
      return replayCommand(args);
    default:
      process.stderr.write(`camelia: unknown command "${command}"\n\n`);
      printHelp(process.stderr.write.bind(process.stderr));
      return EXIT.usage;
  }
}

function printHelp(write: (text: string) => void = (t) => void process.stdout.write(t)): void {
  const theme = createTheme(resolveColour('auto'));
  write(
    [
      '',
      `${theme.accentBold('Camelia')} ${theme.dim(VERSION)} ${theme.dim('\u00b7')} ${theme.grey(SLOGAN)}`,
      '',
      `${theme.bold('USAGE')}`,
      '  camelia <command> [options]',
      '',
      `${theme.bold('COMMANDS')}`,
      `  ${theme.text('run "<task>"')}      plan, execute, verify and deliver one task`,
      `  ${theme.text('serve')}             run the engine as a local SSE server for the desktop UI`,
      `  ${theme.text('doctor')}            check configuration and exercise the pipeline`,
      `  ${theme.text('replay [taskId]')}   read back the durable event log`,
      `  ${theme.text('help')}              show this help`,
      '',
      `${theme.bold('RUN OPTIONS')}`,
      `  ${theme.grey('-w, --workspace <dir>')}   workspace root (default: cwd)`,
      `  ${theme.grey('    --mock')}              use the scripted provider (no API key needed)`,
      `  ${theme.grey('    --spec <file.json>')}  script a specific task (implies --mock)`,
      `  ${theme.grey('    --resume <taskId>')}   continue a paused/interrupted task from its plan`,
      `  ${theme.grey('-y, --yes')}               auto-approve gated tool calls and plans`,
      `  ${theme.grey('    --auto-approve-plan')} auto-approve plans only`,
      `  ${theme.grey('-p, --provider <id>')}     prefer a provider (opencode-zen|openrouter|ollama)`,
      `  ${theme.grey('-m, --model <name>')}      override the decision model`,
      `  ${theme.grey('    --grunt-model <n>')}   override the grunt model`,
      `  ${theme.grey('    --test-command <c>')}  command for test-pass acceptance points`,
      `  ${theme.grey('    --json')}              machine-readable result on stdout`,
      `  ${theme.grey('-q, --quiet')}             only print the final outcome`,
      `  ${theme.grey('    --verbose')}           include planning and verification detail`,
      `  ${theme.grey('    --db <file>')}         override the SQLite database path`,
      `  ${theme.grey('    --no-color')}          disable ANSI colour`,
      '',
      `${theme.bold('SERVE OPTIONS')}`,
      `  ${theme.grey('    --port <n>')}          listen port (default: 7433)`,
      `  ${theme.grey('    --host <addr>')}        bind address (default: 127.0.0.1)`,
      `  ${theme.grey('    --auto-run "<task>"')}  submit a task as soon as a UI attaches`,
      `  ${theme.grey('    --approval-timeout <s>')}  deny an unanswered gate after N seconds (default: 300)`,
      `  ${theme.grey('    --origins <list>')}     comma-separated allowed origins (default: *)`,
      `  ${theme.grey('-w, --workspace <dir>')}   workspace root (default: cwd)`,
      `  ${theme.grey('    --mock')}              use the scripted provider (no API key needed)`,
      `  ${theme.grey('-y, --yes')}               auto-approve gated tool calls and plans`,
      `  ${theme.grey('    --auto-approve-plan')} auto-approve plans only`,
      '',
      `${theme.bold('EXAMPLES')}`,
      `  ${theme.grey('camelia run "add a CONTRIBUTING.md with a code of conduct"')}`,
      `  ${theme.grey('camelia run --mock "smoke test the engine"')}`,
      `  ${theme.grey('camelia serve --mock --auto-run "smoke test the engine"')}`,
      `  ${theme.grey('camelia doctor --offline')}`,
      `  ${theme.grey('camelia replay <taskId>')}`,
      '',
    ].join('\n') + '\n',
  );
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ArgError) {
      process.stderr.write(`camelia: ${error.message}\n`);
      process.exitCode = EXIT.usage;
      return;
    }
    process.stderr.write(`camelia: unexpected error\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = EXIT.failed;
  });