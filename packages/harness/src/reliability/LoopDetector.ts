/**
 * Loop detection — breaks the "agent does the same thing forever" failure.
 *
 * Two independent signals (whitepaper §4.4):
 *  1. action fingerprint repeats (same tool, same arguments)
 *  2. state fingerprint repeats (same plan progress + same context digest)
 * @module
 */

import { fingerprint } from '@camelia/core';

export interface LoopSignal {
  detected: boolean;
  fingerprint: string;
  repeats: number;
  kind: 'action' | 'state' | 'none';
  message: string;
}

export class LoopDetector {
  private readonly actions: string[] = [];
  private readonly states = new Set<string>();
  private readonly stateOrder: string[] = [];

  constructor(private readonly repeatThreshold: number = 3) {}

  /** Record a tool invocation and report whether we are stuck. */
  recordAction(toolName: string, args: unknown): LoopSignal {
    const print = fingerprint(`${toolName}:${stableStringify(args)}`);
    this.actions.push(print);

    let repeats = 0;
    for (let i = this.actions.length - 1; i >= 0 && this.actions[i] === print; i -= 1) repeats += 1;

    if (repeats >= this.repeatThreshold) {
      return {
        detected: true,
        fingerprint: print,
        repeats,
        kind: 'action',
        message: `Tool "${toolName}" called ${repeats}x with identical arguments.`,
      };
    }
    return { detected: false, fingerprint: print, repeats, kind: 'none', message: '' };
  }

  /** Record a coarse state digest; a repeat means the task is not advancing. */
  recordState(digest: string): LoopSignal {
    const print = fingerprint(digest);
    if (this.states.has(print)) {
      return {
        detected: true,
        fingerprint: print,
        repeats: 2,
        kind: 'state',
        message: 'Task state repeated — no progress since this point.',
      };
    }
    this.states.add(print);
    this.stateOrder.push(print);
    return { detected: false, fingerprint: print, repeats: 1, kind: 'none', message: '' };
  }

  /** Consecutive identical trailing actions, for the observability dashboard. */
  get trailingRepeats(): number {
    const last = this.actions[this.actions.length - 1];
    if (last === undefined) return 0;
    let count = 0;
    for (let i = this.actions.length - 1; i >= 0 && this.actions[i] === last; i -= 1) count += 1;
    return count;
  }

  get actionCount(): number {
    return this.actions.length;
  }

  reset(): void {
    this.actions.length = 0;
    this.states.clear();
    this.stateOrder.length = 0;
  }
}

/** Deterministic stringify with sorted keys, so argument order cannot mask a loop. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}