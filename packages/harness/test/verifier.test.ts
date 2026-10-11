/**
 * Step verifier — "the executor claims, the verifier checks" (whitepaper §3.4).
 *
 * The invariants under test are the ones that make verification trustworthy:
 * an unverifiable point is `unknown` (never a silent pass), a completion claim
 * without evidence is downgraded, and an acceptance path outside the workspace is
 * a hard failure rather than an unverifiable check.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { Evidence, StepResult, ToolCall } from '@camelia/core';
import { newId } from '@camelia/core';

import { ApprovalGate } from '../src/approval/ApprovalGate.js';
import { Verifier } from '../src/verification/Verifier.js';
import { FakeShell, acceptancePoint, makeHarness, makeStep } from './helpers/context.js';

function toolCall(name: string, status: ToolCall['status'] = 'ok'): ToolCall {
  return {
    id: newId(),
    stepId: 'step-1',
    taskId: 'task-1',
    name,
    input: {},
    status,
    risk: 'read-only',
    reversible: true,
    traceId: 'trace-test',
    createdAt: 0,
  };
}

function result(partial: Partial<StepResult> = {}): StepResult {
  return {
    stepId: 'step-1',
    status: partial.status ?? 'ok',
    toolCalls: partial.toolCalls ?? [],
    summary: partial.summary ?? '',
    artifacts: partial.artifacts ?? [],
    error: partial.error,
  };
}

describe('Verifier — acceptance kinds', () => {
  it('passes file-exists when the file is present', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/out.txt': 'hi' } });
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('file-exists', { path: 'out.txt' })] });
    const verdict = await new Verifier(h.ctx).verify(step, result());
    expect(verdict.status).toBe('pass');
    expect(verdict.evidence.some((e) => e.kind === 'assertion')).toBe(true);
  });

  it('fails file-exists when the file is absent', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('file-exists', { path: 'missing.txt' })] });
    const verdict = await new Verifier(h.ctx).verify(step, result());
    expect(verdict.status).toBe('fail');
    expect(verdict.reason).toContain('does not exist');
  });

  it('reports file-exists with no path as unknown', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('file-exists', {})] });
    const verdict = await new Verifier(h.ctx).verify(step, result());
    expect(verdict.status).toBe('unknown');
    expect(verdict.reason).toContain('no path');
  });

  it('matches file-contains with a regex', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.ts': 'export function foo() {}' } });
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('file-contains', { path: 'a.ts', pattern: 'export function \\w+' })] });
    expect((await new Verifier(h.ctx).verify(step, result())).status).toBe('pass');
  });

  it('fails file-contains when the pattern is missing', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.ts': 'nothing here' } });
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('file-contains', { path: 'a.ts', pattern: 'zzz' })] });
    expect((await new Verifier(h.ctx).verify(step, result())).status).toBe('fail');
  });

  it('reports file-contains with missing params as unknown', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.ts': 'x' } });
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('file-contains', { path: 'a.ts' })] });
    expect((await new Verifier(h.ctx).verify(step, result())).status).toBe('unknown');
  });

  it('passes command-exit-zero on a zero exit and fails otherwise', async () => {
    const ok = makeHarness({ shell: new FakeShell(() => ({ code: 0 })) });
    const bad = makeHarness({ shell: new FakeShell(() => ({ code: 2 })) });
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('command-exit-zero', { command: 'npm run build' })] });
    expect((await new Verifier(ok.ctx).verify(step, result())).status).toBe('pass');
    expect((await new Verifier(bad.ctx).verify(step, result())).status).toBe('fail');
  });

  it('uses the default test command for test-pass without one', async () => {
    const h = makeHarness({ shell: new FakeShell(() => ({ code: 0 })) });
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('test-pass', {})] });
    await new Verifier(h.ctx, { defaultTestCommand: 'pnpm test' }).verify(step, result());
    expect(h.shell.commands[0]!.command).toBe('pnpm test');
  });

  it('reports a verification command as unknown when the gate denies it', async () => {
    const h = makeHarness({ shell: new FakeShell(() => ({ code: 0 })) });
    const approval = new ApprovalGate(h.ctx.config.approval, async () => false, h.logger, h.metrics);
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('command-exit-zero', { command: 'rm -rf tmp' })] });
    const verdict = await new Verifier(h.ctx, { approval }).verify(step, result());
    expect(verdict.status).toBe('unknown');
    expect(verdict.reason).toContain('not approved');
    expect(h.shell.commands).toHaveLength(0);
  });

  it('passes diff-nonempty when a file artifact was produced', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('diff-nonempty', { path: 'a.ts' })] });
    const verdict = await new Verifier(h.ctx).verify(
      step,
      result({ artifacts: [{ kind: 'file', path: 'a.ts', hash: 'abc' }] }),
    );
    expect(verdict.status).toBe('pass');
    expect(verdict.evidence.some((e) => e.kind === 'file-hash')).toBe(true);
  });

  it('fails diff-nonempty when nothing was modified', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('diff-nonempty', { path: 'a.ts' })] });
    expect((await new Verifier(h.ctx).verify(step, result())).status).toBe('fail');
  });

  it('reports manual acceptance as unknown — a human must decide', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('manual', {})] });
    const verdict = await new Verifier(h.ctx).verify(step, result());
    expect(verdict.status).toBe('unknown');
    expect(verdict.reason).toContain('manual');
  });
});

describe('Verifier — safety boundaries', () => {
  it('fails an acceptance path that escapes the workspace', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('file-exists', { path: '../outside.txt' })] });
    const verdict = await new Verifier(h.ctx).verify(step, result());
    expect(verdict.status).toBe('fail');
    expect(verdict.reason).toContain('escapes the workspace');
  });

  it('persists the verdict for replay', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.txt': 'x' } });
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('file-exists', { path: 'a.txt' })] });
    await new Verifier(h.ctx).verify(step, result());
    expect(h.store.verdicts).toHaveLength(1);
  });
});

describe('Verifier — no declared acceptance points', () => {
  it('fails when the executor reported an error', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [] });
    const verdict = await new Verifier(h.ctx).verify(step, result({ status: 'error', error: 'boom' }));
    expect(verdict.status).toBe('fail');
  });

  it('passes when at least one tool call produced a result', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [] });
    const verdict = await new Verifier(h.ctx).verify(step, result({ toolCalls: [toolCall('fs.write')] }));
    expect(verdict.status).toBe('pass');
  });

  it('reports unknown when nothing happened at all', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [] });
    const verdict = await new Verifier(h.ctx).verify(step, result());
    expect(verdict.status).toBe('unknown');
  });
});

describe('Verifier — hallucination suppression', () => {
  it('downgrades a completion claim with no tool evidence to unknown', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [acceptancePoint('diff-nonempty', { path: 'a.ts' })] });
    const verdict = await new Verifier(h.ctx).verify(
      step,
      result({ summary: 'I have completed the task and all tests pass.', artifacts: [{ kind: 'file', path: 'a.ts' }] }),
    );
    expect(verdict.status).toBe('unknown');
    expect(h.events.some((e) => e.type === 'reliability.hallucination_blocked')).toBe(true);
  });

  it('keeps a completion claim that is backed by evidence', async () => {
    const h = makeHarness();
    const step = makeStep({ idx: 0, acceptance: [] });
    const verdict = await new Verifier(h.ctx).verify(
      step,
      result({ summary: 'Done — tests pass.', toolCalls: [toolCall('test.run')] }),
    );
    expect(verdict.status).toBe('pass');
  });
});

describe('Verifier — evidence extraction', () => {
  it('records tool-call, command-output and file-hash evidence', () => {
    const h = makeHarness();
    const verifier = new Verifier(h.ctx);
    const evidence: Evidence[] = verifier.evidenceFrom(
      result({
        toolCalls: [toolCall('shell.exec'), toolCall('fs.read', 'error')],
        artifacts: [{ kind: 'file', path: 'a.ts', hash: 'h1' }],
      }),
    );
    const kinds = evidence.map((e) => e.kind);
    expect(kinds).toContain('tool-call');
    expect(kinds).toContain('command-output');
    expect(kinds).toContain('file-hash');
    // shell.exec yields both a tool-call and a command-output entry.
    expect(evidence.filter((e) => e.detail === 'shell.exec')).toHaveLength(2);
    // An errored tool call produces no evidence at all.
    expect(evidence.some((e) => e.detail === 'fs.read')).toBe(false);
  });
});

describe('Verifier — file-contains reads the pattern literally first', () => {
  // Regression guard for a measured failure. The planner wrote the acceptance for
  // `export function greet() { return "hi"; }` verbatim; read as a regex the
  // braces are quantifier syntax, so a file written exactly as requested was
  // reported as not matching — the task failed after doing the work correctly.
  it('matches code containing braces literally', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/greet.ts': 'export function greet() { return "hi"; }\n' } });
    const step = makeStep({
      idx: 0,
      acceptance: [acceptancePoint('file-contains', { path: 'greet.ts', pattern: 'export function greet() { return "hi"; }' })],
    });
    expect((await new Verifier(h.ctx).verify(step, result())).status).toBe('pass');
  });

  it('still supports a real regular expression', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.ts': 'export function x() {}' } });
    const step = makeStep({
      idx: 0,
      acceptance: [acceptancePoint('file-contains', { path: 'a.ts', pattern: 'export\\s+function' })],
    });
    expect((await new Verifier(h.ctx).verify(step, result())).status).toBe('pass');
  });

  it('prefers the literal reading when the pattern looks like a regex', async () => {
    // `a+b` present literally must pass, even though the file also happens to
    // match it as a regex. This is the behaviour the measured failure needed:
    // the pattern is the text the model expects the file to contain, so the
    // literal reading decides.
    const h = makeHarness({ seed: { 'C:/workspace/a.txt': 'value is a+b today' } });
    const step = makeStep({
      idx: 0,
      acceptance: [acceptancePoint('file-contains', { path: 'a.txt', pattern: 'a+b' })],
    });
    expect((await new Verifier(h.ctx).verify(step, result())).status).toBe('pass');
  });

  it('reports the literal text in the reason rather than regex notation', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.txt': 'nothing' } });
    const step = makeStep({
      idx: 0,
      acceptance: [acceptancePoint('file-contains', { path: 'a.txt', pattern: 'foo {bar}' })],
    });
    const verdict = await new Verifier(h.ctx).verify(step, result());
    expect(verdict.reason).toContain('does not contain');
    expect(verdict.reason).not.toContain('/foo {bar}/');
  });
});
