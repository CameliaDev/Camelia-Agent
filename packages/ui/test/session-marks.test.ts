import { describe, expect, it } from 'vitest';

import { hideSession, orderSessions, toggleFavorite, togglePinned, type SessionMarks } from '../src/state/session-marks.js';

const empty: SessionMarks = { pinned: [], favorite: [], hidden: [] };
const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('session marks', () => {
  it('puts pinned rows first, then favorites, and drops hidden ones', () => {
    const marked = toggleFavorite(togglePinned(empty, 'c'), 'b');
    expect(orderSessions(rows, marked).map((row) => row.id)).toEqual(['c', 'b', 'a']);
    expect(orderSessions(rows, hideSession(marked, 'c')).map((row) => row.id)).toEqual(['b', 'a']);
  });
});