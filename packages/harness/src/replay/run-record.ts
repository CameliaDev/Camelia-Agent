/**
 * One reproducible run: the model, the prompts, the context snapshot and the
 * tool results. Phase checks can call `readRunRecord` later instead of a live model.
 * @module
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface RunRecord {
  /** Decision model used for planning/execution calls. */
  model: string;
  /** Cheap model used for summaries; absent when it equals `model` (Iteration 24). */
  gruntModel?: string;
  /**
   * Every model-call prompt sent this run, as serialised
   * `{ purpose, model, system }` entries (Iteration 24 — wired from the gateway).
   */
  prompts: string[];
  /** Context snapshot at task end (protected slots + live/compacted entries). */
  context: unknown;
  /** Tool-call records from every executed step. */
  toolResults: unknown[];
  /**
   * The user's original intent exactly as the task was created with
   * (Iteration 26 — so an on-site failure can be replayed offline). Absent in
   * records written before Iteration 26; readers treat it as undefined.
   */
  intentRaw?: string;
  /**
   * The planning input (the clarified intent the plan was built from)
   * (Iteration 26). Absent in old records.
   */
  planInput?: unknown;
}

export async function writeRunRecord(dir: string, record: RunRecord): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'record.json'), JSON.stringify(record, null, 2), 'utf8');
}

export async function readRunRecord(dir: string): Promise<RunRecord> {
  const raw = await readFile(path.join(dir, 'record.json'), 'utf8');
  const parsed = JSON.parse(raw) as RunRecord;
  if (!parsed || typeof parsed.model !== 'string' || !Array.isArray(parsed.prompts) || !Array.isArray(parsed.toolResults)) {
    throw new Error('run record is missing model, prompts or tool results');
  }
  return parsed;
}
