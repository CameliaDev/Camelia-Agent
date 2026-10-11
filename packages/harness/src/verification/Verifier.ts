/**
 * Step verifier (whitepaper §3.4).
 *
 * Deliberately independent of the executor: the executor *claims*, the verifier
 * *checks*. Every verdict carries evidence, and an unverifiable step is reported
 * as `unknown` — never silently upgraded to `pass` (whitepaper §4.2).
 * @module
 */

import type { AcceptancePoint, Evidence, Step, StepResult, Verdict } from '@camelia/core';
import { assertWithin, isWithin, newId, relativeTo } from '@camelia/core';

import type { ApprovalGate } from '../approval/ApprovalGate.js';
import type { RunContext } from '../context/RunContext.js';
import { runMeta } from '../context/RunContext.js';
import { HallucinationGuard } from '../reliability/HallucinationGuard.js';

export interface VerifierOptions {
  /** Command used when an acceptance point declares `test-pass` without a command. */
  defaultTestCommand?: string;
  /**
   * Approval gate for verification commands.
   *
   * Acceptance commands are authored by the model, so running them is a side effect
   * like any other. Without this the verifier would be a hole in the approval
   * boundary: a plan could smuggle an unapproved command in as its own acceptance
   * criterion. When the gate denies, the point is reported `unknown` — we could not
   * verify it, which is the honest verdict, not a silent pass.
   */
  approval?: ApprovalGate;
}

export class Verifier {
  private readonly guard = new HallucinationGuard();

  constructor(
    private readonly ctx: RunContext,
    private readonly options: VerifierOptions = {},
  ) {}

  /** Check a step result against its acceptance points. */
  async verify(step: Step, result: StepResult): Promise<Verdict> {
    const meta = runMeta(this.ctx);
    this.ctx.infra.bus.emit('verify.started', { stepId: step.id, points: step.acceptance.length }, meta);

    const evidence = this.evidenceFrom(result);
    const reasons: string[] = [];
    let failures = 0;
    let unknowns = 0;

    for (const point of step.acceptance) {
      const outcome = await this.checkPoint(point, result);
      evidence.push(...outcome.evidence);
      if (outcome.status === 'fail') {
        failures += 1;
        reasons.push(`FAIL ${point.kind}: ${outcome.reason}`);
      } else if (outcome.status === 'unknown') {
        unknowns += 1;
        reasons.push(`UNKNOWN ${point.kind}: ${outcome.reason}`);
      } else {
        reasons.push(`PASS ${point.kind}: ${outcome.reason}`);
      }
    }

    if (step.acceptance.length === 0) {
      // Risk: empty acceptance can pass on tool evidence, and `unknown` is not
      // `fail`, so a cheap-first retry can lock in a weak result.
      // No declared acceptance points: fall back to evidence-based judgement.
      if (result.status === 'error') {
        failures += 1;
        reasons.push(`FAIL: executor reported an error — ${result.error ?? 'unknown'}`);
      } else if (evidence.some((e) => e.kind === 'tool-call')) {
        reasons.push('PASS: step completed and at least one tool call produced a result');
      } else {
        unknowns += 1;
        reasons.push('UNKNOWN: step declared no acceptance points and made no tool calls');
      }
    }

    let status: Verdict['status'] = failures > 0 ? 'fail' : unknowns > 0 ? 'unknown' : 'pass';

    // Hallucination suppression: a completion claim with no evidence is downgraded.
    if (status === 'pass') {
      const claim = this.guard.checkClaim(result.summary, evidence);
      if (claim.blocked) {
        status = 'unknown';
        reasons.push(`UNKNOWN: ${claim.reason}`);
        this.ctx.infra.bus.emit('reliability.hallucination_blocked', {
          claim: claim.claim,
          reason: claim.reason,
        }, meta);
      }
    }

    const verdict: Verdict = {
      id: newId(),
      stepId: step.id,
      taskId: this.ctx.taskId,
      status,
      evidence,
      reason: reasons.join(' | ') || 'no checks performed',
      createdAt: this.ctx.ports.clock.now(),
    };

    this.ctx.infra.metrics.inc(`verify.${status}`, { step: String(step.idx) });
    this.ctx.infra.bus.emit('verify.result', { verdict }, meta);
    if (status === 'fail') {
      this.ctx.infra.bus.emit('verify.fix_required', { stepId: step.id, verdicts: [verdict] }, meta);
    }
    await this.persist(verdict);
    return verdict;
  }

  /** All evidence produced by a step's tool calls. */
  evidenceFrom(result: StepResult): Evidence[] {
    const evidence: Evidence[] = [];
    for (const call of result.toolCalls) {
      if (call.status === 'ok') {
        evidence.push({ kind: 'tool-call', ref: call.id, detail: call.name });
        if (call.name === 'shell.exec' || call.name === 'test.run') {
          evidence.push({ kind: 'command-output', ref: call.id, detail: call.name });
        }
      }
    }
    for (const artifact of result.artifacts) {
      if (artifact.hash) evidence.push({ kind: 'file-hash', ref: artifact.path, detail: artifact.hash });
    }
    return evidence;
  }

  private async checkPoint(
    point: AcceptancePoint,
    result: StepResult,
  ): Promise<{ status: 'pass' | 'fail' | 'unknown'; reason: string; evidence: Evidence[] }> {
    const params = point.params as Record<string, unknown>;
    try {
      // A path-bearing acceptance point that escapes the workspace is a plan
      // violation, not merely an unverifiable check. `assertWithin` would throw
      // and the generic catch below would downgrade it to `unknown` — which the
      // loop counts as completed progress. Fail it explicitly so a plan cannot
      // earn credit for a mutation outside the sandbox (whitepaper §3.8, §4.2).
      const declaredPath = typeof params.path === 'string' ? params.path : undefined;
      if (declaredPath && !isWithin(this.ctx.workspace, declaredPath)) {
        return {
          status: 'fail',
          reason: `acceptance path escapes the workspace: ${declaredPath}`,
          evidence: [],
        };
      }
      switch (point.kind) {
        case 'file-exists': {
          const path = String(params.path ?? '');
          if (!path) return { status: 'unknown', reason: 'no path supplied', evidence: [] };
          const abs = assertWithin(this.ctx.workspace, path);
          const exists = await this.ctx.ports.fs.exists(abs);
          return {
            status: exists ? 'pass' : 'fail',
            reason: exists ? `${path} exists` : `${path} does not exist`,
            evidence: exists ? [{ kind: 'assertion', ref: path }] : [],
          };
        }
        case 'file-contains': {
          const path = String(params.path ?? '');
          const pattern = String(params.pattern ?? '');
          if (!path || !pattern) {
            return { status: 'unknown', reason: 'path and pattern are required', evidence: [] };
          }
          const abs = assertWithin(this.ctx.workspace, path);
          if (!(await this.ctx.ports.fs.exists(abs))) {
            return { status: 'fail', reason: `${path} does not exist`, evidence: [] };
          }
          const content = await this.ctx.ports.fs.readFile(abs);
          const found = safeRegexTest(pattern, content);
          return {
            status: found ? 'pass' : 'fail',
            reason: found ? `${path} contains ${JSON.stringify(pattern)}` : `${path} does not contain ${JSON.stringify(pattern)}`,
            evidence: found ? [{ kind: 'assertion', ref: `${path}#${pattern}` }] : [],
          };
        }
        case 'command-exit-zero':
        case 'test-pass': {
          const command =
            String(params.command ?? '') ||
            (point.kind === 'test-pass' ? this.options.defaultTestCommand ?? 'npm test' : '');
          if (!command) return { status: 'unknown', reason: 'no command supplied', evidence: [] };
          const approval = await this.approveVerificationCommand(command);
          if (!approval.allowed) {
            return {
              status: 'unknown',
              reason: `verification command \`${command}\` not approved (${approval.reason})`,
              evidence: [],
            };
          }
          const run = await this.ctx.ports.shell.exec(command, {
            cwd: this.ctx.workspace,
            timeoutMs: this.ctx.config.shellTimeoutMs,
          });
          const passed = run.code === 0;
          return {
            status: passed ? 'pass' : 'fail',
            reason: passed
              ? `\`${command}\` exited 0`
              : `\`${command}\` exited ${run.code}${run.timedOut ? ' (timed out)' : ''}`,
            evidence: [{ kind: 'command-output', ref: command, detail: run.stdout.slice(-500) }],
          };
        }
        case 'diff-nonempty': {
          const wanted = typeof params.path === 'string' ? relativeTo(this.ctx.workspace, assertWithin(this.ctx.workspace, params.path)) : undefined;
          const modified = result.artifacts.filter(
            (a) => a.kind === 'file' && (!wanted || a.path === wanted),
          );
          if (modified.length > 0) {
            const paths = modified.map((a) => a.path);
            return {
              status: 'pass',
              reason: `${paths.join(', ')} modified`,
              evidence: modified
                .filter((a) => a.hash)
                .map((a) => ({ kind: 'file-hash' as const, ref: a.path, detail: a.hash })),
            };
          }
          return {
            status: 'fail',
            reason: wanted ? `${wanted} was not modified` : 'no file modification was observed',
            evidence: [],
          };
        }
        case 'manual':
          return {
            status: 'unknown',
            reason: 'manual acceptance requires a human verdict',
            evidence: [],
          };
      }
    } catch (error) {
      return {
        status: 'unknown',
        reason: error instanceof Error ? error.message : String(error),
        evidence: [],
      };
    }
  }

  /**
   * Run a verification command through the approval gate.
   *
   * The input shape matches the executor's `shell.exec` call exactly, so a command
   * the user already approved for execution is not asked about twice — the gate's
   * session-approval fingerprint is the same.
   */
  private async approveVerificationCommand(
    command: string,
  ): Promise<{ allowed: boolean; reason: string }> {
    if (!this.options.approval) return { allowed: true, reason: 'no approval gate configured' };
    const decision = await this.options.approval.decide({
      callId: newId(),
      name: 'shell.exec',
      risk: 'privileged',
      input: { command },
    });
    return { allowed: decision.allowed, reason: decision.reason };
  }

  private async persist(verdict: Verdict): Promise<void> {
    try {
      await this.ctx.infra.store.insertVerdict(verdict);
    } catch (error) {
      this.ctx.infra.logger.warn('failed to persist verdict', { verdictId: verdict.id, error: String(error) });
    }
  }
}

/**
 * Match `pattern` against `content`, preferring a literal reading.
 *
 * `file-contains` says "the file contains this text", so a literal match is the
 * primary interpretation. Regex is a fallback, not the default, because the
 * pattern usually comes from a model writing what the file *should* contain —
 * and measured, `qwen2.5-coder:7b` wrote the acceptance for
 * `export function greet() { return "hi"; }` verbatim. Read as a regex, the
 * braces are quantifier syntax and the check fails on a file that is exactly
 * right, so the task is reported as unverified after doing the work correctly.
 *
 * Trying literal first also removes a class of surprising behaviour: a pattern
 * containing regex metacharacters can never match literally, so regex-first would
 * silently reinterpret it.
 */
function safeRegexTest(pattern: string, content: string): boolean {
  if (content.includes(pattern)) return true;
  try {
    return new RegExp(pattern, 'm').test(content);
  } catch {
    // Not a valid regex and not present literally — genuinely absent.
    return false;
  }
}