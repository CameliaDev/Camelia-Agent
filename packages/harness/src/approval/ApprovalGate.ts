/**
 * Approval gate — the safety boundary between a model's intent and a real effect.
 *
 * Policy is data (see `ApprovalPolicy`), not code scattered through tools, so the
 * whole risk posture is inspectable and testable (whitepaper §3.8).
 * @module
 */

import type { Id, JsonValue, LoggerPort, MetricsPort, RiskLevel } from '@camelia/core';
import { fingerprint } from '@camelia/core';

import type { ApprovalMode, ApprovalPolicy } from '../config.js';

export interface ApprovalRequest {
  callId: Id;
  name: string;
  risk: RiskLevel;
  input: JsonValue;
  /** Why approval is needed — surfaced verbatim in the UI. */
  reason: string;
}

/** Returns true to approve. Supplied by the agent layer (UI prompt or CLI prompt). */
export type ApprovalResponder = (request: ApprovalRequest) => Promise<boolean>;

export interface ApprovalOutcome {
  allowed: boolean;
  by: 'policy' | 'user';
  reason: string;
}

export interface ApprovalCandidate {
  callId: Id;
  name: string;
  risk: RiskLevel;
  input: JsonValue;
  /**
   * Per-tool mode, winning over the risk-based policy.
   *
   * Plugin tools declare `'ask'`, so a low-declared-risk tool cannot ride the
   * `read-only -> auto` policy into an unapproved effect (whitepaper §8.2).
   */
  approval?: ApprovalMode;
}

export class ApprovalGate {
  private readonly sessionApproved = new Set<string>();
  private asked = 0;
  private allowed = 0;
  private denied = 0;

  constructor(
    private readonly policy: ApprovalPolicy,
    private readonly responder?: ApprovalResponder,
    private readonly logger?: LoggerPort,
    private readonly metrics?: MetricsPort,
  ) {}

  /** Stable identity of a call, used for session-level "always allow". */
  private key(candidate: ApprovalCandidate): string {
    return fingerprint(`${candidate.name}:${JSON.stringify(candidate.input ?? null)}`);
  }

  /**
   * Pure predicate: will {@link decide} consult a human for this call?
   *
   * Exposed so the executor can emit `tool.approval_required` *before* awaiting the
   * responder — a UI must learn that a gate is pending at the moment the gate opens,
   * not after the answer arrives. Mirrors `decide`'s decision path exactly; it must
   * never call the responder or mutate counters.
   */
  needsApproval(candidate: ApprovalCandidate): boolean {
    if (this.policyDenial(candidate)) return false;
    const mode = this.modeFor(candidate);
    if (mode !== 'ask') return false;
    if (!this.responder) return false;
    if (this.policy.rememberSessionApprovals && this.sessionApproved.has(this.key(candidate))) return false;
    return true;
  }

  /** The per-tool override when present, otherwise the risk-based policy. */
  private modeFor(candidate: ApprovalCandidate): ApprovalMode {
    return candidate.approval ?? this.policy.byRisk[candidate.risk] ?? 'ask';
  }

  async decide(candidate: ApprovalCandidate): Promise<ApprovalOutcome> {
    const denial = this.policyDenial(candidate);
    if (denial) {
      this.denied += 1;
      this.metrics?.inc('approval.denied', { risk: candidate.risk });
      return { allowed: false, by: 'policy', reason: denial };
    }

    const mode = this.modeFor(candidate);
    if (mode === 'auto') {
      this.allowed += 1;
      this.metrics?.inc('approval.allowed', { risk: candidate.risk });
      return { allowed: true, by: 'policy', reason: `policy auto-approves ${candidate.risk} tools` };
    }
    if (mode === 'deny') {
      this.denied += 1;
      this.metrics?.inc('approval.denied', { risk: candidate.risk });
      return { allowed: false, by: 'policy', reason: `policy denies ${candidate.risk} tools` };
    }

    const key = this.key(candidate);
    if (this.policy.rememberSessionApprovals && this.sessionApproved.has(key)) {
      this.allowed += 1;
      return { allowed: true, by: 'policy', reason: 'already approved for this session' };
    }

    if (!this.responder) {
      this.denied += 1;
      this.metrics?.inc('approval.denied', { risk: candidate.risk });
      return {
        allowed: false,
        by: 'policy',
        reason: `no approver available for ${candidate.risk} tool "${candidate.name}"`,
      };
    }

    this.asked += 1;
    this.metrics?.inc('approval.asked', { risk: candidate.risk });
    const approved = await this.responder({
      callId: candidate.callId,
      name: candidate.name,
      risk: candidate.risk,
      input: candidate.input,
      reason: `Tool "${candidate.name}" is classified ${candidate.risk} and requires approval.`,
    });

    if (approved) {
      if (this.policy.rememberSessionApprovals) this.sessionApproved.add(key);
      this.allowed += 1;
      this.metrics?.inc('approval.allowed', { risk: candidate.risk });
      return { allowed: true, by: 'user', reason: 'approved by user' };
    }

    this.denied += 1;
    this.metrics?.inc('approval.denied', { risk: candidate.risk });
    this.logger?.info('tool denied by user', { tool: candidate.name });
    return { allowed: false, by: 'user', reason: 'denied by user' };
  }

  /** Hard rules that override any per-risk mode. */
  private policyDenial(candidate: ApprovalCandidate): string | undefined {
    const serialized = JSON.stringify(candidate.input ?? {});
    for (const denied of this.policy.deniedPaths) {
      if (serialized.includes(denied)) {
        return `path "${denied}" is on the deny list`;
      }
    }
    if (candidate.name === 'shell.exec' || candidate.name === 'test.run') {
      const command = String((candidate.input as { command?: unknown })?.command ?? '').toLowerCase();
      for (const denied of this.policy.deniedCommands) {
        if (command.includes(denied.toLowerCase())) {
          return `command contains denied pattern "${denied}"`;
        }
      }
    }
    return undefined;
  }

  /** Counters for the observability dashboard. */
  stats(): { asked: number; allowed: number; denied: number } {
    return { asked: this.asked, allowed: this.allowed, denied: this.denied };
  }
}