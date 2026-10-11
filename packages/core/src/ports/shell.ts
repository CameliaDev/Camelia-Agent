/**
 * Shell port. Every command is time-boxed and captured, because an unkillable
 * hanging command is the single most common way an agent loop dies.
 * @module
 */

export interface ShellOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Hard cap on captured stdout/stderr characters (default 200_000). */
  maxOutputChars?: number;
}

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  /** True when output was truncated to `maxOutputChars`. */
  truncated: boolean;
}

export interface ShellPort {
  exec(command: string, options?: ShellOptions): Promise<ShellResult>;
}