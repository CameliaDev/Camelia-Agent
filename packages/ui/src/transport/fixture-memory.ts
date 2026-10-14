/**
 * Fixture memory store — the offline/demo half of the memory panel.
 *
 * The fixture transport must answer the same query commands a live engine answers
 * (`listMemories` / `getMemory` / …) so scenes, screenshots and UI tests can
 * exercise the panel without a model or a database. This is a *scripted stand-in*,
 * clearly not the engine: it is only ever wired to `onCommandResult` inside the
 * fixture transport, never to a real store. The live path keeps reading straight
 * from `EngineServer → SqliteSessionStore`.
 * @module
 */

import type { ForgetLogEntry, MemoryItem, MemoryLayer } from '@camelia/core';

/** Same rule as `@camelia/core` `isCuratedMemory`. Inlined so the browser bundle does not pull Node. */
function isCuratedMemory(item: { kind: string; content: string }): boolean {
  if (item.kind === 'artifact') return false;
  if (/produced \d+ artifact/.test(item.content)) return false;
  return item.kind === 'fact' || item.kind === 'preference' || item.kind === 'lesson' || item.kind === 'procedural';
}
import type { ForgetLogView, MemoryView } from '@camelia/agent/view';

/** Deterministic, pre-scored fixture memories for the panel scenes. */
export function createFixtureMemoryDb(now: number, sessionId: string): FixtureMemoryDb {
  const items: MemoryItem[] = [
    {
      id: 'mem_fixture_long_1',
      scope: 'global',
      kind: 'fact',
      content: 'Camelia matches recall by token overlap — "create a todo module" recalls a memory learned for "build the todo module".',
      keywords: 'recall token matching',
      strength: 0.72,
      importance: 0.8,
      correctness: 0.9,
      hits: 4,
      lastHitAt: now - 2 * 60 * 60 * 1000,
      nextReviewAt: now + 2 * 24 * 60 * 60 * 1000,
      retrievable: false,
      layer: 'long',
      createdAt: now - 5 * 24 * 60 * 60 * 1000,
      updatedAt: now - 2 * 60 * 60 * 1000,
    },
    {
      id: 'mem_fixture_short_1',
      scope: 'session',
      sessionId,
      kind: 'lesson',
      content: 'The todo module needs an idempotent seed — re-running init must not duplicate rows.',
      keywords: 'todo seed idempotent',
      strength: 0.66,
      importance: 0.7,
      correctness: 0.9,
      hits: 2,
      lastHitAt: now - 40 * 60 * 1000,
      nextReviewAt: now + 12 * 60 * 60 * 1000,
      retrievable: false,
      layer: 'short',
      createdAt: now - 3 * 60 * 60 * 1000,
      updatedAt: now - 40 * 60 * 1000,
    },
    {
      id: 'mem_fixture_proc_1',
      scope: 'session',
      sessionId,
      kind: 'procedural',
      content: 'create-todo-module recipe: scaffold files → wire the model → run verification → promote.',
      keywords: 'todo module recipe procedure',
      strength: 0.95,
      importance: 0.85,
      correctness: 1,
      hits: 6,
      lastHitAt: now - 20 * 60 * 1000,
      nextReviewAt: now + 24 * 60 * 60 * 1000,
      retrievable: false,
      layer: 'procedural',
      evidence: {
        taskId: 'tsk_fixture_verify',
        verdict: 'pass',
        at: now - 20 * 60 * 1000,
        detail: 'all steps verified; task completed',
      },
      createdAt: now - 7 * 24 * 60 * 60 * 1000,
      updatedAt: now - 20 * 60 * 1000,
    },
    {
      id: 'mem_fixture_short_2',
      scope: 'session',
      sessionId,
      kind: 'fact',
      content: 'The UI right rail currently holds: plan, context, verification, approvals and memory (Iteration 22).',
      keywords: 'right rail memory panel',
      strength: 0.35,
      importance: 0.55,
      correctness: 0.7,
      hits: 1,
      lastHitAt: now - 5 * 60 * 1000,
      nextReviewAt: now - 5 * 60 * 1000, // the one item currently due for reactivation
      retrievable: false,
      layer: 'short',
      createdAt: now - 5 * 60 * 1000,
      updatedAt: now - 5 * 60 * 1000,
    },
    {
      id: 'mem_fixture_artifact_1',
      scope: 'session',
      sessionId,
      kind: 'artifact',
      content: 'Task "问候用户" produced 1 artifact(s) across 1 step(s).',
      keywords: 'artifact',
      strength: 0.4,
      importance: 0.4,
      correctness: 1,
      hits: 0,
      layer: 'short',
      createdAt: now - 60 * 1000,
      updatedAt: now - 60 * 1000,
    },
  ];

  const forgetLog: ForgetLogEntry[] = [
    {
      id: 'flg_fixture_1',
      memoryId: 'mem_fixture_gone_1',
      contentSnippet: 'api v1 returned array; v2 wraps {items:[…]}…',
      reason: 'user-correction',
      value: 0.12,
      createdAt: now - 90 * 60 * 1000,
    },
  ];

  return {
    items,
    forgetLog,
    list(layer, sessionId, curated) {
      // Mirrors the engine's panel query: a sessionId scopes the list to what that
      // session learned, without folding in `scope = 'global'` rows. Keeping the two
      // paths identical is what stops the offline demo from disagreeing with a real run.
      const scoped = sessionId
        ? items.filter((item) => item.scope === 'session' && item.sessionId === sessionId)
        : items;
      const layered = layer ? scoped.filter((item) => item.layer === layer) : scoped;
      const visible = curated ? layered.filter((item) => isCuratedMemory(item)) : layered;
      return visible.map(toView);
    },
    get(id) {
      const item = items.find((entry) => entry.id === id);
      return item ? toView(item) : null;
    },
    markIncorrect(id) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return null;
      item.correctness = 0;
      item.updatedAt = now;
      return toView(item);
    },
    forget(id, reason) {
      const removed = items.find((entry) => entry.id === id);
      if (!removed) return null;
      const index = items.indexOf(removed);
      items.splice(index, 1);
      forgetLog.unshift({
        id: `flg_${id}`,
        memoryId: id,
        contentSnippet: removed.content.slice(0, 120),
        reason,
        value: removed.strength ?? 0,
        createdAt: now,
      });
      return toView(removed);
    },
    promote(id) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return null;
      if (item.layer === 'short') {
        item.layer = 'long';
        item.scope = 'global';
        item.updatedAt = now;
      }
      return toView(item);
    },
    reactivationDue(limit) {
      return items
        .filter((item) => item.correctness !== 0 && (item.nextReviewAt ?? 0) <= now)
        .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
        .slice(0, limit)
        .map(toView);
    },
    forgetLogEntries(limit) {
      return forgetLog.slice(0, limit).map((entry) => ({
        id: entry.id,
        memoryId: entry.memoryId,
        contentSnippet: entry.contentSnippet,
        reason: entry.reason,
        value: entry.value,
        createdAt: entry.createdAt,
      }));
    },
  };
}

export interface FixtureMemoryDb {
  items: MemoryItem[];
  forgetLog: ForgetLogEntry[];
  list(layer?: MemoryLayer, sessionId?: string, curated?: boolean): MemoryView[];
  get(id: string): MemoryView | null;
  markIncorrect(id: string): MemoryView | null;
  forget(id: string, reason: string): MemoryView | null;
  promote(id: string): MemoryView | null;
  reactivationDue(limit: number): MemoryView[];
  forgetLogEntries(limit: number): ForgetLogView[];
}

function toView(item: MemoryItem): MemoryView {
  return {
    id: item.id,
    scope: item.scope,
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    kind: item.kind,
    content: item.content,
    layer: item.layer ?? (item.scope === 'global' ? 'long' : 'short'),
    strength: item.strength ?? 0.5,
    importance: item.importance ?? 0.5,
    correctness: item.correctness ?? 0.5,
    recency: 0.5,
    hits: item.hits ?? 0,
    ...(item.lastHitAt !== undefined ? { lastHitAt: item.lastHitAt } : {}),
    ...(item.nextReviewAt !== undefined && item.nextReviewAt !== null ? { nextReviewAt: item.nextReviewAt } : {}),
    retrievable: item.retrievable ?? true,
    ...(item.evidence ? { evidence: item.evidence } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
