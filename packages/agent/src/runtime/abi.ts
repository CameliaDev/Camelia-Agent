/**
 * ABI-mismatch failure recording (Iteration 24).
 *
 * When better-sqlite3's native binary was built for a different Node ABI
 * (`NODE_MODULE_VERSION` mismatch), the session store cannot even open — so the
 * failure cannot be written to the `failure_modes` table it would belong to.
 *
 * The compromise is explicit and auditable:
 * 1. On store-open failure caused by an ABI mismatch, append one line to
 *    `~/.camelia/logs/abi-mismatch.jsonl` (out-of-band, the only writable spot).
 * 2. On the next successful start, migrate those lines into `failure_modes` so
 *    the planner can read the recorded mechanism like any other failure mode,
 *    then drop the sidecar.
 *
 * The `mechanism` names the code path, never a prompt sentence.
 * @module
 */

import fs from 'node:fs';

import type { SessionStore } from '@camelia/core';

/** Error markers produced by Node's native-module loader on ABI mismatch. */
const ABI_MARKERS = [
  'was compiled against a different Node.js version',
  'NODE_MODULE_VERSION',
  'Module version mismatch',
];

export function isAbiMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return ABI_MARKERS.some((marker) => message.includes(marker));
}

export interface AbiMismatchLine {
  ts: number;
  workspace: string;
  mechanism: string;
}

/** Append one ABI-mismatch record to the sidecar log (best effort). */
export function appendAbiMismatch(logsDir: string, workspace: string, error: unknown): void {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const line: AbiMismatchLine = {
      ts: Date.now(),
      workspace,
      mechanism: `abi-mismatch: native module load failed (${error instanceof Error ? error.message.slice(0, 160) : String(error)})`,
    };
    fs.appendFileSync(`${logsDir}/abi-mismatch.jsonl`, `${JSON.stringify(line)}\n`, 'utf8');
  } catch {
    // Nothing else is writable either — a boot-time log write must not mask the
    // original store error, which the caller rethrows.
  }
}

/**
 * Move sidecar ABI-mismatch records into `failure_modes` now that the store is
 * usable again, then remove the sidecar so a fixed ABI is not double-recorded.
 * Only `recordFailureMode` is required — the migration must be testable against
 * the smallest possible surface.
 */
export async function migrateAbiMismatch(
  store: Pick<SessionStore, 'recordFailureMode'>,
  logsDir: string,
  workspace: string,
): Promise<void> {
  const file = `${logsDir}/abi-mismatch.jsonl`;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no sidecar — nothing to migrate
  }
  const rows: AbiMismatchLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      const line = JSON.parse(raw) as AbiMismatchLine;
      if (line.workspace === workspace) rows.push(line);
    } catch {
      /* malformed sidecar line — skip */
    }
  }
  for (const row of rows) {
    try {
      await store.recordFailureMode({
        kind: 'abi-mismatch',
        mechanism: row.mechanism,
        workspace: row.workspace,
      });
    } catch {
      /* best effort */
    }
  }
  if (rows.length > 0) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* best effort */
    }
  }
}
