/**
 * Holds a run at `awaiting-approval` until the UI (or a CLI prompt) answers.
 *
 * Same posture as tool approval: no answer is not a yes. `session` scope arms
 * later plans in this process so they skip the wait.
 * @module
 */

import type { Id, PlanEdit } from '@camelia/core';

export type PlanDecision =
  | { action: 'approve'; scope: 'once' | 'session' }
  | { action: 'reject'; reason: string }
  | { action: 'edit'; edits: PlanEdit[] };

export class PlanGate {
  private sessionAuto = false;
  private readonly pending = new Map<Id, (decision: PlanDecision) => void>();

  get sessionAutoApprove(): boolean {
    return this.sessionAuto;
  }

  armSession(): void {
    this.sessionAuto = true;
  }

  ask(taskId: Id): Promise<PlanDecision> {
    return new Promise((resolve) => {
      this.pending.set(taskId, resolve);
    });
  }

  /** Settle the only waiting plan. Returns false when none or more than one is waiting. */
  settleOnly(decision: PlanDecision): boolean {
    if (this.pending.size !== 1) return false;
    const taskId = this.pending.keys().next().value;
    if (!taskId) return false;
    return this.settle(taskId, decision);
  }

  settle(taskId: Id, decision: PlanDecision): boolean {
    const resolve = this.pending.get(taskId);
    if (!resolve) return false;
    this.pending.delete(taskId);
    if (decision.action === 'approve' && decision.scope === 'session') this.armSession();
    resolve(decision);
    return true;
  }
}
