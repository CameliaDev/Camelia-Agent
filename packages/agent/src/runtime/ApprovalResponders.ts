/**
 * Approval responders — the human side of the approval gate.
 *
 * The harness owns *policy*; the agent layer owns *asking*. Keeping the two apart
 * is what lets the CLI prompt interactively, the UI render a modal, and tests run
 * headless with a deterministic answer (whitepaper §3.8).
 * @module
 */

import { createInterface } from 'node:readline/promises';

import type { ApprovalRequest, ApprovalResponder } from '@camelia/harness';

/** Approve everything. Used by `--yes` and by non-destructive automation. */
export function autoApprover(): ApprovalResponder {
  return async () => true;
}

/** Deny everything. Used when no human is available and the tool needs consent. */
export function denyApprover(): ApprovalResponder {
  return async () => false;
}

function renderPrompt(request: ApprovalRequest): string {
  const detail = JSON.stringify(request.input ?? {});
  return [
    '',
    `Camelia needs approval for a ${request.risk} tool call:`,
    `  tool: ${request.name}`,
    `  args: ${detail.length > 400 ? `${detail.slice(0, 400)}…` : detail}`,
    'Approve? [y/N] ',
  ].join('\n');
}

/**
 * Ask on the terminal. When stdin is not a TTY (piped input, CI) the call is
 * denied rather than hanging — an unanswered prompt must never stall a run.
 *
 * The readline interface is opened and closed per question: an interface left open
 * holds a stdin handle that keeps the process alive after the task finishes.
 */
export function interactiveApprover(): ApprovalResponder {
  const ask = async (request: ApprovalRequest): Promise<boolean> => {
    if (!process.stdin.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(renderPrompt(request));
      return /^y(es)?$/i.test(answer.trim());
    } finally {
      rl.close();
    }
  };
  return ask;
}