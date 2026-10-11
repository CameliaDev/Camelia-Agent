/**
 * Node shell adapter for the `ShellPort` contract.
 *
 * Every command is time-boxed and output-capped. A hanging command is the single
 * most common way an agent loop dies, so the timeout is not optional
 * (whitepaper §3.7, §4.3).
 * @module
 */

import { spawn } from 'node:child_process';

import type { ShellOptions, ShellPort, ShellResult } from '@camelia/core';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 200_000;

export class NodeShell implements ShellPort {
  async exec(command: string, options: ShellOptions = {}): Promise<ShellResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutput = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;

    return new Promise<ShellResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const child = spawn(command, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: true,
        windowsHide: true,
      });

      const capture = (chunk: Buffer, target: 'out' | 'err'): void => {
        const text = chunk.toString('utf8');
        if (target === 'out') {
          if (stdout.length + text.length > maxOutput) {
            stdout += text.slice(0, Math.max(0, maxOutput - stdout.length));
            truncated = true;
          } else {
            stdout += text;
          }
        } else if (stderr.length + text.length > maxOutput) {
          stderr += text.slice(0, Math.max(0, maxOutput - stderr.length));
          truncated = true;
        } else {
          stderr += text;
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        // On Windows a shell-spawned process ignores SIGTERM, so escalate.
        try {
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // best effort
        }
      }, timeoutMs);

      const finish = (code: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          code,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
          truncated,
        });
      };

      child.stdout?.on('data', (chunk: Buffer) => capture(chunk, 'out'));
      child.stderr?.on('data', (chunk: Buffer) => capture(chunk, 'err'));
      child.on('error', (error) => {
        stderr += `\n${error.message}`;
        finish(127);
      });
      child.on('close', (code) => finish(timedOut ? 124 : code ?? 0));
    });
  }
}