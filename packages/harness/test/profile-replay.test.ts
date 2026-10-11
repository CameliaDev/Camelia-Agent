import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProjectProfile, profileFromIterationNotes } from '../src/profile/project-profile.js';
import { readRunRecord, writeRunRecord } from '../src/replay/run-record.js';

describe('project profile', () => {
  it('parses only the profile schema', () => {
    const profile = parseProjectProfile(`
name: camelia
conventions:
  - Keep keys in ~/.camelia
pitfalls:
  - Empty acceptance can pass
verification:
  - Re-run the gate
forbidden:
  - Do not send telemetry
`);
    expect(profile.name).toBe('camelia');
    expect(profile.forbidden).toEqual(['Do not send telemetry']);
  });

  it('rejects a key outside the schema', () => {
    expect(() => parseProjectProfile('name: x\nextra: 1\n')).toThrow(/schema/);
  });

  it('compiles a profile from iteration notes', () => {
    const yaml = profileFromIterationNotes('camelia', '- leftover snap test\n');
    expect(parseProjectProfile(yaml).pitfalls[0]).toBe('leftover snap test');
  });
});

describe('run record', () => {
  it('round-trips a reproducible run directory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'camelia-run-'));
    try {
      await writeRunRecord(dir, {
        model: 'scripted',
        prompts: ['plan'],
        context: { goal: 'write a file' },
        toolResults: [{ name: 'fs.write', ok: true }],
      });
      const record = await readRunRecord(dir);
      expect(record.model).toBe('scripted');
      expect(record.toolResults).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
