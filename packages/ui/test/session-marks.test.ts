import { describe, expect, it } from 'vitest';

import {
  hideSession,
  orderSessions,
  sessionKeepIds,
  toggleFavorite,
  togglePinned,
  unhideSession,
  type SessionMarks,
} from '../src/state/session-marks.js';

const empty: SessionMarks = { pinned: [], favorite: [], hidden: [] };
const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('session marks', () => {
  it('puts pinned rows first, then favorites, and drops hidden ones', () => {
    const marked = toggleFavorite(togglePinned(empty, 'c'), 'b');
    expect(orderSessions(rows, marked).map((row) => row.id)).toEqual(['c', 'b', 'a']);
    expect(orderSessions(rows, hideSession(marked, 'c')).map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('keeps keepIds visible even when hidden (active session must stay listed)', () => {
    const marked = hideSession(hideSession(empty, 'a'), 'c');
    expect(orderSessions(rows, marked).map((row) => row.id)).toEqual(['b']);
    expect(orderSessions(rows, marked, { keepIds: ['a'] }).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('drops keepIds while the active session is the one being deleted', () => {
    expect(sessionKeepIds('a', 'a')).toEqual([]);
    expect(sessionKeepIds('a', null)).toEqual(['a']);
    expect(sessionKeepIds(undefined)).toEqual([]);
    expect(sessionKeepIds('a', 'b')).toEqual(['a']);
  });

  it('unhideSession clears a hide mark', () => {
    const marked = hideSession(empty, 'a');
    expect(unhideSession(marked, 'a').hidden).toEqual([]);
    expect(unhideSession(marked, 'missing')).toEqual(marked);
  });
});
