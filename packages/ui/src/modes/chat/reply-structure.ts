/**
 * Reply structure parsing and tool-run grouping — borrowed from Hermes-style UIs.
 *
 * Two presentation problems, two pure functions:
 *
 * 1. `parseReplyStructure` — the Work-chat system prompt makes every assistant reply
 *    open with `Goal:` / `Constraints:` / `Short plan:`. Rendering those as plain
 *    paragraphs buries the answer under three walls of machine-readable text.
 *    Parsing is deliberately all-or-nothing: unless all three markers are present
 *    the text renders as one block, so a reply that merely mentions "goal" never
 *    gets half-cardised.
 *
 * 2. `groupToolCalls` — consecutive finished tools collapse into one summary card
 *    that expands on click; a running or approval-waiting call always stands alone.
 * @module
 */

import type { ToolCallView } from '@camelia/agent/view';

/** The three sections the system prompt asks every Work-chat reply to open with. */
export interface ReplyStructure {
  goal: string;
  constraints: string[];
  plan: string[];
  /** What follows the plan — the actual answer. */
  body: string;
}

/**
 * `Goal: …`, optionally markdown-bolded (`**Goal:**`). The trailing `\**\s*` after
 * the colon matters: without it the match stops at `**Goal:` and the section slice
 * starts on a stray `**`.
 */
const GOAL_RE = /^\**\s*goal\s*\**\s*[:：]\**\s*/im;
const CONSTRAINTS_RE = /^\**\s*constraints?\s*\**\s*[:：]\**\s*/im;
const PLAN_RE = /^\**\s*(?:short\s+)?plan\s*\**\s*[:：]\**\s*/im;

/** Strip markdown emphasis and list bullets from a line. */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\*\*/g, '')
    .trim();
}

/** Split a section body into entries: bullets for constraints, numbers for the plan. */
function sectionLines(text: string): string[] {
  return text
    .split('\n')
    .map(cleanLine)
    .filter((line) => line.length > 0);
}

/**
 * The plan is the last preamble section, so it must stop where the answer begins:
 * numbered lines are steps, the first non-numbered non-empty line opens the body.
 */
function splitPlan(text: string): { plan: string[]; body: string } {
  const lines = text.split('\n');
  const plan: string[] = [];
  let bodyFrom = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    if (raw.trim().length === 0) continue;
    if (/^\s*(?:\d+[.)]|[-*•])\s+/.test(raw)) plan.push(cleanLine(raw));
    else {
      bodyFrom = i;
      break;
    }
  }
  return { plan, body: lines.slice(bodyFrom).join('\n').trim() };
}

/**
 * Parse the `Goal / Constraints / Short plan` preamble out of an assistant reply.
 *
 * Returns `undefined` when the reply does not carry all three markers — the caller
 * then renders the text as one block, exactly as before.
 */
export function parseReplyStructure(text: string): ReplyStructure | undefined {
  const goalMatch = GOAL_RE.exec(text);
  const constraintsMatch = CONSTRAINTS_RE.exec(text);
  const planMatch = PLAN_RE.exec(text);
  if (!goalMatch || !constraintsMatch || !planMatch) return undefined;

  // Sections must appear in the prompt's order: goal, constraints, plan.
  const goalAt = goalMatch.index;
  const constraintsAt = constraintsMatch.index;
  const planAt = planMatch.index;
  if (!(goalAt < constraintsAt && constraintsAt < planAt)) return undefined;

  const goal = cleanLine(text.slice(goalAt + goalMatch[0].length, constraintsAt).split('\n')[0] ?? '');
  if (!goal) return undefined;

  const constraints = sectionLines(text.slice(constraintsAt + constraintsMatch[0].length, planAt));
  const { plan, body } = splitPlan(text.slice(planAt + planMatch[0].length));
  if (constraints.length === 0 || plan.length === 0) return undefined;

  return { goal, constraints, plan, body };
}

/** Finished tool statuses — eligible for grouping. */
function isFinished(call: ToolCallView): boolean {
  return call.status === 'ok' || call.status === 'error' || call.status === 'denied';
}

/**
 * Group a turn's tool calls for display.
 *
 * Two or more *consecutive* finished calls become one group; everything else
 * stands alone.
 */
export function groupToolCalls(
  calls: readonly ToolCallView[],
): Array<{ kind: 'group'; calls: ToolCallView[] } | { kind: 'single'; call: ToolCallView }> {
  const out: Array<{ kind: 'group'; calls: ToolCallView[] } | { kind: 'single'; call: ToolCallView }> = [];
  let run: ToolCallView[] = [];

  const flush = (): void => {
    if (run.length >= 2) out.push({ kind: 'group', calls: run });
    else for (const call of run) out.push({ kind: 'single', call });
    run = [];
  };

  for (const call of calls) {
    if (isFinished(call)) run.push(call);
    else {
      flush();
      out.push({ kind: 'single', call });
    }
  }
  flush();
  return out;
}

/** The header label for a tool group: deduped names, first three, then `+N`. */
export function toolGroupLabel(calls: readonly ToolCallView[]): string {
  const names = [...new Set(calls.map((call) => call.name))];
  const shown = names.slice(0, 3).join(' · ');
  return names.length > 3 ? `${shown} · +${names.length - 3}` : shown;
}

/** Worst status in a group — an error outranks everything else. */
export function toolGroupStatus(calls: readonly ToolCallView[]): 'ok' | 'error' | 'running' {
  if (calls.some((call) => call.status === 'error' || call.status === 'denied')) return 'error';
  if (calls.some((call) => call.status === 'running' || call.status === 'awaiting-approval')) return 'running';
  return 'ok';
}
