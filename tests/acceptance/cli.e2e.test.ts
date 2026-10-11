/**
 * Phase 1 acceptance — the CLI completes real coding tasks (whitepaper §7, §9).
 *
 * These suites spawn the *built* `camelia` binary as a real child process, so what
 * is asserted here is exactly what a user gets on the command line: real argument
 * parsing, a real SQLite file, real filesystem mutations and real exit codes.
 * @module
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_BIN = fileURLToPath(new URL('../../packages/cli/dist/bin.js', import.meta.url));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  cwd?: string;
  home?: string;
}

/** Spawn the built CLI and collect its full output. Never throws on non-zero exit. */
function runCli(args: string[], options: RunOptions = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(options.home ? { CAMELIA_HOME: options.home } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('camelia CLI — Phase 1 acceptance', () => {
  let home: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI_BIN)) {
      throw new Error(`CLI not built at ${CLI_BIN} — run \`pnpm build\` before the e2e suite.`);
    }
    home = tempDir('camelia-e2e-home-');
  });

  it('completes a real coding task end to end (exit 0, file written, command verified)', async () => {
    const workspace = tempDir('camelia-e2e-ws-');
    const spec = {
      create: {
        'math.mjs': [
          'export const add = (a, b) => a + b;',
          "if (add(2, 3) !== 5) { console.error('FAIL'); process.exit(1); }",
          "console.log('math.mjs ok');",
          '',
        ].join('\n'),
      },
      commands: ['node math.mjs'],
    };
    const specFile = path.join(workspace, '..', `spec-${Date.now()}.json`);
    fs.writeFileSync(specFile, JSON.stringify(spec));

    const result = await runCli(
      ['run', 'create a math module and verify it', '--spec', specFile, '--yes', '--json', '--workspace', workspace],
      { home },
    );

    expect(result.code, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      steps: { completed: number; total: number; unverified: number };
      artifacts: string[];
      verdicts: { status: string }[];
    };

    expect(payload.status).toBe('done');
    expect(payload.steps.unverified).toBe(0);
    expect(payload.steps.completed).toBe(payload.steps.total);
    expect(payload.artifacts).toContain('math.mjs');
    expect(payload.verdicts.every((v) => v.status === 'pass')).toBe(true);

    // The mutation is real and the command that verified it really ran.
    const written = fs.readFileSync(path.join(workspace, 'math.mjs'), 'utf8');
    expect(written).toContain('export const add');

    fs.rmSync(specFile, { force: true });
  });

  it('refuses a task whose acceptance escapes the workspace (exit 1, nothing written)', async () => {
    const parent = tempDir('camelia-e2e-escape-');
    const workspace = path.join(parent, 'ws');
    fs.mkdirSync(workspace);
    const specFile = path.join(parent, 'escape.json');
    fs.writeFileSync(specFile, JSON.stringify({ create: { '../escaped.ts': 'nope' } }));

    const result = await runCli(
      ['run', 'escape the workspace', '--spec', specFile, '--yes', '--json', '--workspace', workspace],
      { home },
    );

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.stdout) as { status: string };
    expect(payload.status).toBe('failed');
    expect(fs.existsSync(path.join(parent, 'escaped.ts'))).toBe(false);
    expect(fs.existsSync(path.join(workspace, 'escaped.ts'))).toBe(false);
  });

  it('runs the offline mock pipeline with no API key', async () => {
    const workspace = tempDir('camelia-e2e-mock-');
    const result = await runCli(['run', '--mock', 'smoke test the engine', '--yes', '--json', '--workspace', workspace], {
      home,
    });

    expect(result.code, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as { status: string; artifacts: string[] };
    expect(payload.status).toBe('done');
    expect(payload.artifacts).toContain('camelia-mock-output.md');
    expect(fs.existsSync(path.join(workspace, 'camelia-mock-output.md'))).toBe(true);
  });

  it('replays the durable event log for a completed task', async () => {
    const workspace = tempDir('camelia-e2e-replay-');
    const dbFile = path.join(tempDir('camelia-e2e-db-'), 'camelia.db');

    const run = await runCli(
      ['run', '--mock', 'replay me', '--yes', '--json', '--workspace', workspace, '--db', dbFile],
      { home },
    );
    expect(run.code, run.stderr).toBe(0);
    const { taskId } = JSON.parse(run.stdout) as { taskId: string };

    const replay = await runCli(['replay', taskId, '--json', '--db', dbFile], { home });
    expect(replay.code, replay.stderr).toBe(0);

    const events = JSON.parse(replay.stdout) as { type: string }[];
    expect(events.length).toBeGreaterThan(0);
    const types = events.map((e) => e.type);
    // The full lifecycle is observable from the log alone.
    expect(types).toContain('task.status_changed');
    expect(types.some((t) => t.startsWith('tool.'))).toBe(true);
    expect(types.some((t) => t.startsWith('verify.'))).toBe(true);
  });

  it('resumes a persisted task by id (--resume) without creating a new one', async () => {
    const workspace = tempDir('camelia-e2e-resume-');
    const dbFile = path.join(tempDir('camelia-e2e-resume-db-'), 'camelia.db');

    const first = await runCli(
      ['run', '--mock', 'resume me', '--yes', '--json', '--workspace', workspace, '--db', dbFile],
      { home },
    );
    expect(first.code, first.stderr).toBe(0);
    const created = JSON.parse(first.stdout) as { taskId: string; steps: { total: number } };

    const resumed = await runCli(
      ['run', '--resume', created.taskId, '--mock', '--yes', '--json', '--workspace', workspace, '--db', dbFile],
      { home },
    );
    expect(resumed.code, resumed.stderr).toBe(0);
    const payload = JSON.parse(resumed.stdout) as { taskId: string; status: string; steps: { completed: number } };
    expect(payload.taskId).toBe(created.taskId);
    expect(payload.status).toBe('done');
    expect(payload.steps.completed).toBe(created.steps.total);

    // The resume re-entered the same task, and that is visible in the durable log.
    const replay = await runCli(['replay', created.taskId, '--json', '--db', dbFile], { home });
    const types = (JSON.parse(replay.stdout) as { type: string }[]).map((e) => e.type);
    expect(types).toContain('task.resumed');
  });

  it('doctor self-test exercises the whole pipeline offline', async () => {
    const result = await runCli(['doctor', '--offline', '--no-color'], { home });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('pipeline done');
  });

  it('reports a usage error (exit 2) when no task is given', async () => {
    const result = await runCli(['run', '--json'], { home });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('usage');
  });
});
