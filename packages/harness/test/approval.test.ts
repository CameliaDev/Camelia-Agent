/**
 * Approval gate — the policy boundary that decides whether a model's intent may
 * become an effect (whitepaper §3.8).
 *
 * These tests pin the four independent rules: per-risk mode, hard deny lists,
 * session-level "always allow", and the fail-closed behaviour when no approver is
 * available. Getting any of these wrong turns the gate into decoration.
 * @module
 */

import { describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '@camelia/core';

import { ApprovalGate } from '../src/approval/ApprovalGate.js';
import { defaultApprovalPolicy, type ApprovalPolicy } from '../src/config.js';
import { makeHarness } from './helpers/context.js';

function gate(overrides: Partial<ApprovalPolicy> = {}, responder?: (req: unknown) => Promise<boolean>) {
  const h = makeHarness();
  const policy: ApprovalPolicy = { ...defaultApprovalPolicy, ...overrides };
  const instance = new ApprovalGate(policy, responder as never, h.logger, h.metrics);
  return { gate: instance, h };
}

const candidate = (name: string, risk: 'read-only' | 'write' | 'destructive' | 'network' | 'privileged', input: JsonValue = {}) => ({
  callId: 'call-1',
  name,
  risk,
  input,
});

describe('ApprovalGate — policy modes', () => {
  it('auto-approves a read-only tool', async () => {
    const { gate: g } = gate();
    const outcome = await g.decide(candidate('fs.read', 'read-only'));
    expect(outcome.allowed).toBe(true);
    expect(outcome.by).toBe('policy');
  });

  it('auto-approves a write tool by default', async () => {
    const { gate: g } = gate();
    expect((await g.decide(candidate('fs.write', 'write'))).allowed).toBe(true);
  });

  it('denies a privileged tool when the policy says deny', async () => {
    const { gate: g } = gate({ byRisk: { ...defaultApprovalPolicy.byRisk, privileged: 'deny' } });
    const outcome = await g.decide(candidate('shell.exec', 'privileged', { command: 'ls' }));
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toContain('denies');
  });
});

describe('ApprovalGate — hard deny rules', () => {
  it('denies a path on the deny list regardless of risk mode', async () => {
    const { gate: g } = gate();
    const outcome = await g.decide(candidate('fs.write', 'write', { path: '.git/config' }));
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toContain('deny list');
  });

  it('denies a dangerous shell command regardless of approval mode', async () => {
    const { gate: g } = gate({ byRisk: { ...defaultApprovalPolicy.byRisk, privileged: 'auto' } });
    const outcome = await g.decide(candidate('shell.exec', 'privileged', { command: 'sudo rm -rf /' }));
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toContain('denied pattern');
  });

  it('does not treat a benign command as dangerous', async () => {
    const { gate: g } = gate({ byRisk: { ...defaultApprovalPolicy.byRisk, privileged: 'auto' } });
    expect((await g.decide(candidate('shell.exec', 'privileged', { command: 'npm test' }))).allowed).toBe(true);
  });
});

describe('ApprovalGate — interactive approval', () => {
  it('asks the responder and honours approval', async () => {
    const responder = vi.fn(async () => true);
    const { gate: g } = gate({}, responder);
    const outcome = await g.decide(candidate('shell.exec', 'privileged', { command: 'ls' }));
    expect(outcome.allowed).toBe(true);
    expect(outcome.by).toBe('user');
    expect(responder).toHaveBeenCalledTimes(1);
  });

  it('honours a denial', async () => {
    const { gate: g } = gate({}, async () => false);
    const outcome = await g.decide(candidate('shell.exec', 'privileged', { command: 'ls' }));
    expect(outcome.allowed).toBe(false);
    expect(outcome.by).toBe('user');
  });

  it('remembers a session approval so an identical call is not asked twice', async () => {
    const responder = vi.fn(async () => true);
    const { gate: g } = gate({}, responder);
    await g.decide(candidate('shell.exec', 'privileged', { command: 'npm test' }));
    const second = await g.decide(candidate('shell.exec', 'privileged', { command: 'npm test' }));
    expect(second.allowed).toBe(true);
    expect(second.reason).toContain('already approved');
    expect(responder).toHaveBeenCalledTimes(1);
  });

  it('does not remember when the policy disables it', async () => {
    const responder = vi.fn(async () => true);
    const { gate: g } = gate({ rememberSessionApprovals: false }, responder);
    await g.decide(candidate('shell.exec', 'privileged', { command: 'npm test' }));
    await g.decide(candidate('shell.exec', 'privileged', { command: 'npm test' }));
    expect(responder).toHaveBeenCalledTimes(2);
  });

  it('fails closed when no approver is available', async () => {
    const { gate: g } = gate();
    const outcome = await g.decide(candidate('shell.exec', 'privileged', { command: 'ls' }));
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toContain('no approver');
  });
});

describe('ApprovalGate — observability', () => {
  it('tracks asked/allowed/denied counters', async () => {
    const { gate: g } = gate({}, async () => true);
    await g.decide(candidate('fs.read', 'read-only'));
    await g.decide(candidate('shell.exec', 'privileged', { command: 'ls' }));
    await g.decide(candidate('fs.write', 'write', { path: '.env' }));
    expect(g.stats()).toEqual({ asked: 1, allowed: 2, denied: 1 });
  });
});

describe('ApprovalGate — needsApproval predicate', () => {
  it('predicts a human gate for an ask-risk tool with a responder', () => {
    const { gate: g } = gate({}, async () => true);
    expect(g.needsApproval(candidate('shell.exec', 'privileged', { command: 'ls' }))).toBe(true);
  });

  it('is false for auto and deny modes', () => {
    const auto = gate({ byRisk: { ...defaultApprovalPolicy.byRisk, privileged: 'auto' } }, async () => true).gate;
    const deny = gate({ byRisk: { ...defaultApprovalPolicy.byRisk, privileged: 'deny' } }, async () => true).gate;
    expect(auto.needsApproval(candidate('shell.exec', 'privileged', { command: 'ls' }))).toBe(false);
    expect(deny.needsApproval(candidate('shell.exec', 'privileged', { command: 'ls' }))).toBe(false);
  });

  it('is false when no responder is wired (the gate would fail closed)', () => {
    const { gate: g } = gate();
    expect(g.needsApproval(candidate('shell.exec', 'privileged', { command: 'ls' }))).toBe(false);
  });

  it('is false for a hard-deny rule even in ask mode', () => {
    const { gate: g } = gate({}, async () => true);
    expect(g.needsApproval(candidate('fs.write', 'write', { path: '.git/config' }))).toBe(false);
  });

  it('is false once the same call was approved for the session', async () => {
    const { gate: g } = gate({}, async () => true);
    const call = candidate('shell.exec', 'privileged', { command: 'npm test' });
    expect(g.needsApproval(call)).toBe(true);
    await g.decide(call);
    expect(g.needsApproval(call)).toBe(false);
  });

  it('has no side effects — it neither asks nor moves the counters', () => {
    const responder = vi.fn(async () => true);
    const { gate: g } = gate({}, responder);
    g.needsApproval(candidate('shell.exec', 'privileged', { command: 'ls' }));
    expect(responder).not.toHaveBeenCalled();
    expect(g.stats()).toEqual({ asked: 0, allowed: 0, denied: 0 });
  });
});