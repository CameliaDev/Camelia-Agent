/**
 * Reply structure parsing and tool-run grouping — borrowed from Hermes-style UIs.
 *
 * Presentation helpers (pure):
 *
 * 1. `parseReplyStructure` — strip Goal / Constraints / Plan preamble; bubble shows body.
 * 2. `groupToolCalls` — consecutive finished tools collapse into one summary card.
 * 3. `coalesceTranscript` — merge consecutive assistant turns into one visual message
 *    (ChatLoop opens a new turnId per tool round; Cursor/Claude/Codex keep one bubble).
 * @module
 */

import type { ChatTurnView, ToolCallView } from '@camelia/agent/view';

/** The three sections the system prompt asks every Work-chat reply to open with. */
export interface ReplyStructure {
  goal: string;
  constraints: string[];
  plan: string[];
  /** What follows the plan — the actual answer. */
  body: string;
}

/**
 * One row in the chat transcript after coalescing.
 * User turns stay alone; consecutive assistant turns (tool rounds) become one item.
 */
export type TranscriptItem =
  | { kind: 'user'; turn: ChatTurnView }
  | { kind: 'assistant'; turns: ChatTurnView[] };

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
 * then shows the full text as the answer. When present, only `body` is shown in
 * the chat bubble; Goal / Constraints / Plan stay out of the message card.
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
 * stands alone. Prefer `ProcessFold` over this when rendering a whole assistant
 * message — one disclosure for every tool in the coalesced turn.
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

/**
 * Fold consecutive assistant turns into one transcript item.
 *
 * ChatLoop allocates a fresh turnId every tool iteration, so the projection
 * stores N assistant turns for one user ask. Mainstream chat UIs (Cursor,
 * Claude, ChatGPT/Codex) render that as a single assistant message with tools
 * inside a collapsed process disclosure — not N bubbles with N avatars.
 */
export function coalesceTranscript(turns: readonly ChatTurnView[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let buf: ChatTurnView[] = [];

  const flush = (): void => {
    if (buf.length === 0) return;
    items.push({ kind: 'assistant', turns: buf });
    buf = [];
  };

  for (const turn of turns) {
    if (turn.role === 'user') {
      flush();
      items.push({ kind: 'user', turn });
    } else {
      buf.push(turn);
    }
  }
  flush();
  return items;
}

/** Visible answer text after stripping Goal/Constraints/Plan scratchpad. */
export function answerBody(text: string): string {
  const structure = parseReplyStructure(text);
  if (structure) return structure.body;
  if (/^\**\s*goal\s*\**/im.test(text.trimStart())) return '';
  return text;
}
