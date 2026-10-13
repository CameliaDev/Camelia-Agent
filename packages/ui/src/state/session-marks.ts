/**
 * Pin, favorite and hide marks for the session list.
 *
 * These are window chrome, like rail width: they are not domain events.
 * A hidden id stays out of the list after a reload. The engine row is left
 * in place so a mark never rewrites the task journal.
 *
 * The **active** session is never filtered out (see `orderSessions` `keepIds`):
 * "删除" only hides a row from history, but the engine may still resume that
 * session on the next launch — showing an empty rail while chat continues.
 * @module
 */

const KEY = 'camelia.sessionMarks';

export interface SessionMarks {
  pinned: string[];
  favorite: string[];
  hidden: string[];
}

const EMPTY: SessionMarks = { pinned: [], favorite: [], hidden: [] };

function asIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 500);
}

export function loadSessionMarks(storage?: Storage): SessionMarks {
  const bin = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (!bin) return { ...EMPTY, pinned: [], favorite: [], hidden: [] };
  try {
    const raw = JSON.parse(bin.getItem(KEY) ?? '') as Partial<SessionMarks>;
    return { pinned: asIds(raw.pinned), favorite: asIds(raw.favorite), hidden: asIds(raw.hidden) };
  } catch {
    return { pinned: [], favorite: [], hidden: [] };
  }
}

export function saveSessionMarks(marks: SessionMarks, storage?: Storage): void {
  const bin = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (!bin) return;
  bin.setItem(KEY, JSON.stringify(marks));
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];
}

export function togglePinned(marks: SessionMarks, id: string): SessionMarks {
  return { ...marks, pinned: toggle(marks.pinned, id) };
}

export function toggleFavorite(marks: SessionMarks, id: string): SessionMarks {
  return { ...marks, favorite: toggle(marks.favorite, id) };
}

export function hideSession(marks: SessionMarks, id: string): SessionMarks {
  return {
    pinned: marks.pinned.filter((item) => item !== id),
    favorite: marks.favorite.filter((item) => item !== id),
    hidden: marks.hidden.includes(id) ? marks.hidden : [id, ...marks.hidden],
  };
}

/** Undo a hide mark — used when the user (or the engine) brings a session back on screen. */
export function unhideSession(marks: SessionMarks, id: string): SessionMarks {
  if (!marks.hidden.includes(id)) return marks;
  return { ...marks, hidden: marks.hidden.filter((item) => item !== id) };
}

/**
 * Ids `orderSessions` must keep even when hidden.
 *
 * The active session stays listed so a resumed chat is not an empty rail.
 * The session the user is deleting must not: if it is the last row, keepIds
 * would pin it on screen and the hide would look like it failed.
 */
export function sessionKeepIds(activeId: string | undefined, leavingId?: string | null): string[] {
  if (!activeId) return [];
  if (leavingId && leavingId === activeId) return [];
  return [activeId];
}

export function orderSessions<T extends { id: string }>(
  sessions: T[],
  marks: SessionMarks,
  options?: { keepIds?: Array<string | undefined | null> },
): T[] {
  const hidden = new Set(marks.hidden);
  const pinned = new Set(marks.pinned);
  const favorite = new Set(marks.favorite);
  const keep = new Set(
    (options?.keepIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const rank = (id: string): number => (pinned.has(id) ? 0 : favorite.has(id) ? 1 : 2);
  return sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => keep.has(session.id) || !hidden.has(session.id))
    .sort((a, b) => rank(a.session.id) - rank(b.session.id) || a.index - b.index)
    .map(({ session }) => session);
}
