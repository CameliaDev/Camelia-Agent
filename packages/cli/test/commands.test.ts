/**
 * CLI command tests (whitepaper §7).
 *
 * The e2e suite spawns the built binary; this suite drives the same commands
 * in-process so their branches (json vs human output, usage errors, spec loading,
 * replay, doctor) are covered without a child process. Together they pin the CLI
 * contract: exit codes, machine-readable output and human-readable output.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseArgs, type ParsedArgs } from '../src/args.js';
import { doctorCommand } from '../src/commands/doctor.js';
import { replayCommand } from '../src/commands/replay.js';
import { runCommand } from '../src/commands/run.js';
import { serveCommand } from '../src/commands/serve.js';

const roots: string[] = [];
let home: string;
const originalHome = process.env.CAMELIA_HOME;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

beforeAll(() => {
  home = tempDir('camelia-cli-home-');
  process.env.CAMELIA_HOME = home;
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.CAMELIA_HOME;
  else process.env.CAMELIA_HOME = originalHome;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** Run a command with stdout/stderr captured so the suite stays quiet. */
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const so = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const se = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  try {
    const value = await fn();
    return { value, stdout: out.join(''), stderr: err.join('') };
  } finally {
    so.mockRestore();
    se.mockRestore();
  }
}

describe('camelia run', () => {
  it('completes an offline task and emits machine-readable JSON', async () => {
    const workspace = tempDir('camelia-cli-run-');
    const db = path.join(tempDir('camelia-cli-db-'), 'camelia.db');

    const { value, stdout } = await capture(() =>
      runCommand(parseArgs(['run', '--mock', 'smoke test', '--yes', '--json', '--workspace', workspace, '--db', db])),
    );

    expect(value).toBe(0);
    const payload = JSON.parse(stdout) as { status: string; artifacts: string[]; taskId: string };
    expect(payload.status).toBe('done');
    expect(payload.artifacts).toContain('camelia-mock-output.md');
    expect(fs.existsSync(path.join(workspace, 'camelia-mock-output.md'))).toBe(true);
  });

  it('renders the human-readable outcome (header, badge, artifacts)', async () => {
    const workspace = tempDir('camelia-cli-human-');
    const db = path.join(tempDir('camelia-cli-human-db-'), 'camelia.db');

    const { value, stdout } = await capture(() =>
      runCommand(parseArgs(['run', '--mock', 'human mode', '--yes', '--no-color', '--workspace', workspace, '--db', db])),
    );

    expect(value).toBe(0);
    expect(stdout).toContain('Camelia');
    expect(stdout).toContain('done');
    expect(stdout).toContain('artifacts');
    expect(stdout).toContain('camelia-mock-output.md');
  });

  it('loads a scripted spec and verifies a real command', async () => {
    const workspace = tempDir('camelia-cli-spec-');
    const specFile = path.join(workspace, 'spec.json');
    fs.writeFileSync(specFile, JSON.stringify({ create: { 'a.txt': 'A' }, commands: [] }));

    const { value } = await capture(() =>
      runCommand(parseArgs(['run', 'create a.txt', '--spec', specFile, '--yes', '--json', '--workspace', workspace])),
    );

    expect(value).toBe(0);
    expect(fs.readFileSync(path.join(workspace, 'a.txt'), 'utf8')).toBe('A');
  });

  it('rejects a usage error when no task is given', async () => {
    await expect(runCommand(parseArgs(['run', '--json']))).rejects.toThrow(/usage/);
  });

  it('resumes a persisted task from its stored plan', async () => {
    const workspace = tempDir('camelia-cli-resume-');
    const db = path.join(tempDir('camelia-cli-resume-db-'), 'camelia.db');

    const first = await capture(() =>
      runCommand(parseArgs(['run', '--mock', 'resume me', '--yes', '--json', '--workspace', workspace, '--db', db])),
    );
    expect(first.value).toBe(0);
    const created = JSON.parse(first.stdout) as { taskId: string; steps: { total: number } };

    const second = await capture(() =>
      runCommand(parseArgs(['run', '--resume', created.taskId, '--mock', '--yes', '--json', '--workspace', workspace, '--db', db])),
    );

    expect(second.value).toBe(0);
    const resumed = JSON.parse(second.stdout) as { status: string; taskId: string; steps: { completed: number } };
    expect(resumed.taskId).toBe(created.taskId);
    expect(resumed.status).toBe('done');
    expect(resumed.steps.completed).toBe(created.steps.total);
  });

  it('rejects a resume for an unknown task id', async () => {
    const workspace = tempDir('camelia-cli-resume-missing-');
    const db = path.join(tempDir('camelia-cli-resume-missing-db-'), 'camelia.db');
    await expect(
      runCommand(parseArgs(['run', '--resume', 'does-not-exist', '--mock', '--json', '--workspace', workspace, '--db', db])),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a workspace that does not exist', async () => {
    const missing = path.join(tempDir('camelia-cli-missing-'), 'nope');
    await expect(
      runCommand(parseArgs(['run', '--mock', 'x', '--workspace', missing])),
    ).rejects.toThrow(/workspace does not exist/);
  });

  it('rejects a spec file that is not valid JSON', async () => {
    const workspace = tempDir('camelia-cli-badspec-');
    const specFile = path.join(workspace, 'bad.json');
    fs.writeFileSync(specFile, '{ not json');
    await expect(
      runCommand(parseArgs(['run', 'x', '--spec', specFile, '--workspace', workspace])),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('rejects a spec file that does not exist', async () => {
    const workspace = tempDir('camelia-cli-nospec-');
    await expect(
      runCommand(parseArgs(['run', 'x', '--spec', path.join(workspace, 'missing.json'), '--workspace', workspace])),
    ).rejects.toThrow(/spec file not found/);
  });
});

describe('camelia replay', () => {
  it('replays the durable event log of a completed task as JSON', async () => {
    const workspace = tempDir('camelia-cli-replay-');
    const db = path.join(tempDir('camelia-cli-replay-db-'), 'camelia.db');

    const run = await capture(() =>
      runCommand(parseArgs(['run', '--mock', 'replay me', '--yes', '--json', '--workspace', workspace, '--db', db])),
    );
    const { taskId } = JSON.parse(run.stdout) as { taskId: string };

    const { value, stdout } = await capture(() => replayCommand(parseArgs(['replay', taskId, '--json', '--db', db])));

    expect(value).toBe(0);
    const events = JSON.parse(stdout) as { type: string }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.type)).toContain('task.status_changed');
  });

  it('renders a human-readable replay', async () => {
    const workspace = tempDir('camelia-cli-replay-human-');
    const db = path.join(tempDir('camelia-cli-replay-human-db-'), 'camelia.db');

    const run = await capture(() =>
      runCommand(parseArgs(['run', '--mock', 'replay human', '--yes', '--json', '--workspace', workspace, '--db', db])),
    );
    const { taskId } = JSON.parse(run.stdout) as { taskId: string };

    const { value, stdout } = await capture(() =>
      replayCommand(parseArgs(['replay', taskId, '--no-color', '--db', db])),
    );

    expect(value).toBe(0);
    expect(stdout).toContain('Replay');
  });

  it('lists recent sessions when no task id is given', async () => {
    const workspace = tempDir('camelia-cli-sessions-');
    const db = path.join(tempDir('camelia-cli-sessions-db-'), 'camelia.db');

    await capture(() =>
      runCommand(parseArgs(['run', '--mock', 'list me', '--yes', '--json', '--workspace', workspace, '--db', db])),
    );

    const { value, stdout } = await capture(() => replayCommand(parseArgs(['replay', '--no-color', '--db', db])));

    expect(value).toBe(0);
    expect(stdout).toContain('Recent sessions');
  });

  it('reports failure for an unknown task id', async () => {
    const db = path.join(tempDir('camelia-cli-unknown-db-'), 'camelia.db');
    const { value, stdout } = await capture(() =>
      replayCommand(parseArgs(['replay', 'does-not-exist', '--no-color', '--db', db])),
    );

    expect(value).toBe(1);
    expect(stdout).toContain('no events for task');
  });

  it('reports an empty log when nothing has been recorded yet', async () => {
    const db = path.join(tempDir('camelia-cli-empty-db-'), 'camelia.db');
    const { value, stdout } = await capture(() => replayCommand(parseArgs(['replay', '--no-color', '--db', db])));

    expect(value).toBe(0);
    expect(stdout).toContain('no sessions recorded yet');
  });
});

describe('camelia doctor', () => {
  it('self-tests the whole pipeline offline', async () => {
    const { value, stdout } = await capture(() => doctorCommand(parseArgs(['doctor', '--offline', '--no-color'])));

    expect(value).toBe(0);
    expect(stdout).toContain('Camelia doctor');
    expect(stdout).toContain('pipeline done');
  });

  it('reports the environment without running the self-test', async () => {
    const { value, stdout } = await capture(() => doctorCommand(parseArgs(['doctor', '--no-color'])));

    expect(value).toBe(0);
    expect(stdout).toContain('providers');
    expect(stdout).toContain('camelia doctor --offline');
    expect(stdout).not.toContain('pipeline done');
  });
});

/**
 * Drive `serve` in-process: start it, wait until the banner is on stdout, then trigger the
 * injected stop and collect the exit code. The command blocks on shutdown by design, so the
 * `stop` seam is what makes it drivable without signalling the test runner.
 */
async function driveServe(
  args: ParsedArgs,
  bannerSeen: (stdout: string) => boolean,
): Promise<{ value: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const so = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const se = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  let stop!: () => void;
  const stopPromise = new Promise<void>((resolve) => {
    stop = resolve;
  });
  try {
    const pending = serveCommand(args, { stop: stopPromise });
    const deadline = Date.now() + 15_000;
    while (!bannerSeen(out.join('')) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    stop();
    return { value: await pending, stdout: out.join(''), stderr: err.join('') };
  } finally {
    so.mockRestore();
    se.mockRestore();
  }
}

describe('camelia serve', () => {
  it('boots the engine, prints the JSON banner and shuts down cleanly', async () => {
    const workspace = tempDir('camelia-cli-serve-');
    const { value, stdout } = await driveServe(
      parseArgs(['serve', '--mock', '--json', '--port', '0', '--workspace', workspace]),
      (s) => s.includes('"url"'),
    );

    expect(value).toBe(0);
    const banner = JSON.parse(stdout) as { url: string; sessionId: string; provider: string };
    expect(banner.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(banner.provider).toBe('mock');
    expect(banner.sessionId).toBeTruthy();
  });

  it('prints the human banner with the attach URL', async () => {
    const workspace = tempDir('camelia-cli-serve-human-');
    const { value, stdout } = await driveServe(
      parseArgs(['serve', '--mock', '--no-color', '--port', '0', '--workspace', workspace]),
      (s) => s.includes('attach the desktop UI'),
    );

    expect(value).toBe(0);
    expect(stdout).toContain('engine');
    expect(stdout).toContain('127.0.0.1');
  });

  it('accepts a scripted spec, custom origins and an approval timeout', async () => {
    const workspace = tempDir('camelia-cli-serve-spec-');
    const specFile = path.join(workspace, 'spec.json');
    fs.writeFileSync(specFile, JSON.stringify({ create: { 'a.txt': 'A' } }));

    const { value, stdout } = await driveServe(
      parseArgs([
        'serve',
        '--spec',
        specFile,
        '--json',
        '--port',
        '0',
        '--auto-run',
        'do the thing',
        '--origins',
        'http://localhost:4173',
        '--approval-timeout',
        '30',
        '--workspace',
        workspace,
      ]),
      (s) => s.includes('"url"'),
    );

    expect(value).toBe(0);
    expect((JSON.parse(stdout) as { provider: string }).provider).toBe('mock');
  });

  it('rejects an invalid port before starting anything', async () => {
    await expect(serveCommand(parseArgs(['serve', '--port', 'not-a-port']))).rejects.toThrow(/invalid --port/);
  });
});