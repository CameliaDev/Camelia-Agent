/**
 * Run record carries the raw intent (Iteration 26 — Stage 4.1).
 *
 * The gate: after ONE real runtime run, `record.json` under the configured
 * `runRecordDir` must contain the user's original intent (`intentRaw`) and the
 * planning input, so any on-site failure can be replayed offline. This drives
 * the full real path: `CameliaRuntime.run(rawIntent)` → `store.createTask` →
 * `AgentLoop.finish()` → `writeRunRecord`, then reads the file back cold.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CameliaRuntime, MockProvider, mockDemoSpec, scriptedTaskScript, type ProviderHandle } from '@camelia/agent';
import { readRunRecord, type RunRecord } from '../../harness/src/replay/run-record.js';

const roots: string[] = [];
const originalHome = process.env.CAMELIA_HOME;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

beforeAll(() => {
  process.env.CAMELIA_HOME = tempDir('camelia-intent-home-');
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.CAMELIA_HOME;
  else process.env.CAMELIA_HOME = originalHome;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const RAW_INTENT = 'Add a hello.txt containing the word hello at the workspace root';

describe('run record includes the raw intent after one real run (Iteration 26)', () => {
  it('writes intentRaw + planInput to record.json through the real runtime path, readable offline', async () => {
    const runRecordDir = tempDir('camelia-i26-runs-');
    const workspace = tempDir('camelia-i26-ws-');
    const script = scriptedTaskScript(mockDemoSpec('intent-run'));
    const handle: ProviderHandle = {
      id: 'mock',
      label: 'Scripted mock',
      model: 'scripted',
      models: ['scripted'],
      port: new MockProvider({ id: 'mock', models: ['scripted'], script }),
    };
    const runtime = await CameliaRuntime.create({
      workspace,
      runRecordDir,
      providerHandles: [handle],
      autoApprove: true,
      planApproval: 'auto',
      logLevel: 'error',
      logTo: () => undefined,
    });

    try {
      const result = await runtime.run(RAW_INTENT);
      expect(result.outcome.status).toBe('done');

      const recordPath = path.join(runRecordDir, result.task.id, 'record.json');
      expect(fs.existsSync(recordPath)).toBe(true);

      // Cold read: the record is self-contained, no runtime needed.
      const record = (await readRunRecord(path.join(runRecordDir, result.task.id))) as RunRecord;
      expect(record.intentRaw).toBe(RAW_INTENT);
      const planInput = record.planInput as { goal: string };
      expect(typeof planInput.goal).toBe('string');
      expect(planInput.goal.length).toBeGreaterThan(10);
      expect(record.model).toBe('scripted');
      expect(record.prompts.length).toBeGreaterThanOrEqual(2);
      expect(record.toolResults.length).toBeGreaterThan(0);
    } finally {
      await runtime.close();
    }
  });
});
