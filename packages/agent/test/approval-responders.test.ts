/**
 * Approval responder tests (whitepaper §3.8).
 *
 * The human side of the approval gate must be *safe by default*: when no human is
 * attached, a privileged call is denied rather than left hanging. These tests pin the
 * three responders — auto, deny, and interactive — including the non-TTY fast path and
 * the prompt truncation for large tool input.
 * @module
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const rl = vi.hoisted(() => ({
  question: vi.fn(async (_prompt: string): Promise<string> => 'y'),
  close: vi.fn(),
}));

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: rl.question, close: rl.close }),
}));

import type { ApprovalRequest } from '@camelia/harness';

import { autoApprover, denyApprover, interactiveApprover } from '../src/runtime/ApprovalResponders.js';

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { callId: 'call-1', name: 'shell.exec', risk: 'privileged', input: { command: 'npm test' }, reason: 'runs a command', ...overrides };
}

function setTty(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

describe('approval responders', () => {
  afterEach(() => {
    rl.question.mockClear();
    rl.close.mockClear();
    rl.question.mockResolvedValue('y');
  });

  it('autoApprover approves without asking', async () => {
    expect(await autoApprover()(request())).toBe(true);
    expect(rl.question).not.toHaveBeenCalled();
  });

  it('denyApprover denies without asking', async () => {
    expect(await denyApprover()(request())).toBe(false);
    expect(rl.question).not.toHaveBeenCalled();
  });

  it('interactiveApprover denies when stdin is not a TTY instead of hanging', async () => {
    setTty(false);
    expect(await interactiveApprover()(request())).toBe(false);
    expect(rl.question).not.toHaveBeenCalled();
  });

  it('interactiveApprover approves on y and closes the interface', async () => {
    setTty(true);
    rl.question.mockResolvedValueOnce('yes');
    expect(await interactiveApprover()(request())).toBe(true);
    expect(rl.close).toHaveBeenCalledTimes(1);
  });

  it('interactiveApprover denies on anything that is not yes', async () => {
    setTty(true);
    rl.question.mockResolvedValueOnce('n');
    expect(await interactiveApprover()(request())).toBe(false);
  });

  it('truncates very large tool input in the prompt', async () => {
    setTty(true);
    await interactiveApprover()(request({ input: { blob: 'x'.repeat(1000) } }));
    const prompt = rl.question.mock.calls.at(-1)?.[0] as string;
    expect(prompt).toContain('shell.exec');
    expect(prompt).toContain('…');
  });
});