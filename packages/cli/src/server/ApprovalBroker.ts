/**
 * Approval broker — the human side of the approval gate when the human is a webview.
 *
 * The harness decides *whether* consent is needed; `Executor` announces the gate with
 * `tool.approval_required`; this class holds the run suspended until the UI answers
 * with an `approve_tool` / `deny_tool` command. Timeouts and shutdown both fail
 * **closed** (deny), matching `ApprovalGate`'s posture: an unanswered prompt must never
 * silently become a yes, and must never hang a run forever (whitepaper §3.8).
 * @module
 */

import type { Id, JsonValue, LoggerPort, RiskLevel } from '@camelia/core';
import type { ApprovalRequest, ApprovalResponder } from '@camelia/harness';

/** A gate the UI is expected to answer. */
export interface PendingApproval {
  callId: Id;
  name: string;
  risk: RiskLevel;
  input: JsonValue;
  reason: string;
  at: number;
}

interface Waiter {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ApprovalBrokerOptions {
  /** How long to wait for the UI before denying. Default 5 minutes. */
  timeoutMs?: number;
  logger?: LoggerPort;
}

export class ApprovalBroker {
  private readonly waiters = new Map<Id, Waiter>();
  private readonly pending = new Map<Id, PendingApproval>();
  private readonly timeoutMs: number;
  private readonly logger?: LoggerPort;

  /** Number of gates currently waiting on the UI. */
  private asked = 0;
  private approved = 0;
  private denied = 0;
  private timedOut = 0;

  constructor(options: ApprovalBrokerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
    this.logger = options.logger;
  }

  /** The responder to hand to `CameliaRuntime.create`. */
  responder(): ApprovalResponder {
    return (request) => this.ask(request);
  }

  /** Gates the UI has not answered yet, oldest first. */
  list(): PendingApproval[] {
    return [...this.pending.values()].sort((a, b) => a.at - b.at);
  }

  get size(): number {
    return this.pending.size;
  }

  stats(): { asked: number; approved: number; denied: number; timedOut: number; pending: number } {
    return { asked: this.asked, approved: this.approved, denied: this.denied, timedOut: this.timedOut, pending: this.pending.size };
  }

  /**
   * Answer a gate. Returns false when the id is unknown — a late answer for an
   * already-timed-out gate is not an error, it just has nothing to resolve.
   */
  settle(callId: Id, approved: boolean): boolean {
    const waiter = this.waiters.get(callId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.waiters.delete(callId);
    this.pending.delete(callId);
    if (approved) this.approved += 1;
    else this.denied += 1;
    this.logger?.info('approval settled by ui', { callId, approved });
    waiter.resolve(approved);
    return true;
  }

  /** Deny every outstanding gate — called on shutdown so a run can unwind. */
  rejectAll(reason = 'engine shutting down'): number {
    const ids = [...this.waiters.keys()];
    for (const id of ids) this.settle(id, false);
    if (ids.length > 0) this.logger?.warn('denied pending approvals on shutdown', { count: ids.length, reason });
    return ids.length;
  }

  private ask(request: ApprovalRequest): Promise<boolean> {
    this.asked += 1;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(request.callId);
        this.pending.delete(request.callId);
        this.timedOut += 1;
        this.logger?.warn('approval timed out — denying', { callId: request.callId, tool: request.name });
        resolve(false);
      }, this.timeoutMs);
      // A pending gate must not keep the process alive on its own.
      timer.unref?.();
      this.waiters.set(request.callId, { resolve, timer });
      this.pending.set(request.callId, {
        callId: request.callId,
        name: request.name,
        risk: request.risk,
        input: request.input,
        reason: request.reason,
        at: Date.now(),
      });
    });
  }
}