/**
 * Human-facing event timeline — collapse chat.delta spam into turn nodes.
 *
 * The Events panel used to dump every `chat.delta` as its own row (a git log of
 * noise). Meaningful turns / tools / plan steps stay; high-frequency stream
 * chunks fold into one summary node per turn.
 * @module
 */

import type { TimelineEntry } from '@camelia/agent/view';

/** Event types that are pure stream noise when shown one-per-token. */
const DELTA_TYPES = new Set(['chat.delta']);

/** Prefer these as "graph" nodes; everything else still shows unless filtered. */
const PRIMARY_TYPES = new Set([
  'chat.received',
  'chat.message',
  'chat.failed',
  'chat.tool',
  'chat.ask_user',
  'chat.answered',
  'chat.policy_changed',
  'task.created',
  'task.started',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'task.paused',
  'task.resumed',
  'plan.proposed',
  'plan.approved',
  'plan.rejected',
  'plan.edited',
  'step.started',
  'step.completed',
  'step.failed',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'work.mode_set',
  'work.plan_saved',
]);

export type TimelineNode =
  | { kind: 'event'; entry: TimelineEntry }
  | { kind: 'delta-group'; turnId?: string; count: number; chars: number; at: number; summary: string };

function deltaChars(entry: TimelineEntry): number {
  const s = entry.summary ?? '';
  // Summaries often look like `+12` or a short preview.
  const m = /^\+(\d+)\b/.exec(s.trim());
  if (m) return Number(m[1]);
  return s.length;
}

function turnIdOf(entry: TimelineEntry): string | undefined {
  const s = entry.summary ?? '';
  const m = /turn[_:]([A-Za-z0-9-]+)/i.exec(s) ?? /\b(c-[a-z0-9]+|turn_[A-Za-z0-9]+)\b/i.exec(s);
  return m?.[1];
}

/**
 * Fold a raw timeline into display nodes (chronological oldest → newest).
 * Pass `includeDeltas: true` to keep every chat.delta (debug).
 */
export function buildEventTimeline(
  timeline: readonly TimelineEntry[],
  opts: { includeDeltas?: boolean } = {},
): TimelineNode[] {
  const includeDeltas = opts.includeDeltas === true;
  const out: TimelineNode[] = [];
  let group: { turnId?: string; count: number; chars: number; at: number } | undefined;

  const flush = (): void => {
    if (!group || group.count === 0) {
      group = undefined;
      return;
    }
    out.push({
      kind: 'delta-group',
      turnId: group.turnId,
      count: group.count,
      chars: group.chars,
      at: group.at,
      summary: `streamed ${group.chars || group.count} chars · ${group.count} deltas`,
    });
    group = undefined;
  };

  for (const entry of timeline) {
    if (!includeDeltas && DELTA_TYPES.has(entry.type)) {
      if (!group) group = { turnId: turnIdOf(entry), count: 0, chars: 0, at: entry.at };
      group.count += 1;
      group.chars += deltaChars(entry);
      group.at = entry.at;
      continue;
    }
    flush();
    out.push({ kind: 'event', entry });
  }
  flush();
  return out;
}

/** Filter helper for the search box — delta groups match "delta" / "stream". */
export function nodeMatchesFilter(node: TimelineNode, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  if (node.kind === 'delta-group') {
    return (
      'delta'.includes(needle) ||
      'stream'.includes(needle) ||
      node.summary.toLowerCase().includes(needle) ||
      (node.turnId ?? '').toLowerCase().includes(needle)
    );
  }
  return (
    node.entry.type.toLowerCase().includes(needle) ||
    (node.entry.summary ?? '').toLowerCase().includes(needle)
  );
}

export function isPrimaryEvent(type: string): boolean {
  return PRIMARY_TYPES.has(type);
}
