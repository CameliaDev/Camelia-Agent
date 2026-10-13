/**
 * Left rail — Hermes-style session sidebar.
 *
 * The column is the session list: search, a pinned group, then recent rows.
 * A row is a title plus a one-line preview. Pin, favorite and delete sit in the
 * trailing slot and only appear on hover, so the title does not grow a toolbar.
 *
 * There is deliberately no footer. This column used to close with a profile row — the user's
 * mark, their name, a version line — and the icon rail outside carried a matching mark for
 * the closed state, so an open column showed the same avatar twice. The account entry now
 * lives only in the rail (`IconRail`), where it cannot be duplicated by a layout the reader
 * did not ask for; the column ends with its list.
 *
 * Everything above the list is the reserved slot for a nav strip — it is deliberately left
 * to the header for now, so the list keeps the full height instead of sharing it with
 * placeholder chrome.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { count, shortId } from '../lib/format.js';
import { t } from '../i18n/strings.js';
import { makeCommand } from '../state/store.js';
import {
  hideSession,
  loadSessionMarks,
  orderSessions,
  saveSessionMarks,
  toggleFavorite,
  togglePinned,
  type SessionMarks,
} from '../state/session-marks.js';
import { useNewSession } from '../state/new-session.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { Chip, Icon, SectionHeader } from './primitives.js';

export function SessionRail(): ReactNode {
  const { snapshot, sessions, activeSessionId, status, dispatch, setActiveSession } = useUiState();
  const collapsed = useUiStore((s) => s.localPrefs.leftCollapsed);
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  /** Shared with the icon rail, so both entry points start a chat the same way. */
  const newSession = useNewSession();
  const [marks, setMarks] = useState<SessionMarks>(() => loadSessionMarks());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const applyMarks = (next: SessionMarks): void => {
    saveSessionMarks(next);
    setMarks(next);
  };
  const needle = query.trim().toLowerCase();
  const listed = orderSessions(
    needle
      ? sessions.filter((session) => `${session.title} ${session.provider} ${session.model}`.toLowerCase().includes(needle))
      : sessions,
    marks,
  );
  const pinnedRows = listed.filter((session) => marks.pinned.includes(session.id));
  const recentRows = listed.filter((session) => !marks.pinned.includes(session.id));
  const renderSession = (session: (typeof listed)[number]): ReactNode => {
    const active = session.id === activeSessionId;
    const pinned = marks.pinned.includes(session.id);
    const favorite = marks.favorite.includes(session.id);
    const confirming = confirmId === session.id;
    return (
      <div
        key={session.id}
        data-session={session.id}
        onClick={() => {
          if (active) return;
          dispatch(makeCommand('select_session', { sessionId: session.id }));
          setActiveSession(session.id);
        }}
        className={`group relative flex items-center gap-1.5 rounded-md border px-2 py-1 ${
          active
            ? 'border-accent bg-accent/[0.04] shadow-[0_0_0_1px_var(--color-accent)]'
            : 'cursor-pointer border-transparent hover:border-line hover:bg-hover/60'
        }`}
        title={`${session.title} · ${session.model}`}
      >
        {/*
          One line per session. The old row stacked title / model / 运行中 into three
          lines, which at a 260px rail made every entry ~75px tall — a list of eight
          sessions filled the column and pushed the rest off-screen.
          The model moved into the row's tooltip rather than sharing the line: it is
          usually the same string on every row (it is the active provider's model, not a
          per-session choice), and spending 45% of the width on it truncated titles to
          nine characters. Selection is the accent ring plus the leading dot; "is
          something running" is the activity bar and the top bar's progress rail.
        */}
        {active ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
        <p
          data-session-title
          className={`flex min-w-0 flex-1 items-center gap-1 text-[12.5px] leading-[18px] ${active ? 'font-medium text-ink' : 'text-ink-2'}`}
        >
          {pinned ? <Icon name="pin" size={11} strokeWidth={1.6} className="shrink-0 text-accent" /> : null}
          {favorite ? <Icon name="star" size={11} strokeWidth={1.6} filled className="shrink-0 text-warn" /> : null}
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
        </p>
        {confirming ? (
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-elevated px-1">
            <button
              type="button"
              className="text-[11px] text-bad hover:underline"
              onClick={() => {
                applyMarks(hideSession(marks, session.id));
                setConfirmId(null);
              }}
            >
              {tr('sessions.confirmDelete')}
            </button>
            <button type="button" className="text-[11px] text-ink-3 hover:text-ink" onClick={() => setConfirmId(null)}>
              {tr('sessions.cancelDelete')}
            </button>
          </div>
        ) : (
          <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center rounded bg-elevated pl-1 opacity-0 group-hover:pointer-events-auto group-hover:bg-hover group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            <button
              type="button"
              aria-label={pinned ? tr('sessions.unpin') : tr('sessions.pin')}
              title={pinned ? tr('sessions.unpin') : tr('sessions.pin')}
              className={`grid h-[22px] w-[22px] place-items-center rounded ${pinned ? 'text-accent' : 'text-ink-3 hover:text-ink'}`}
              onClick={() => applyMarks(togglePinned(marks, session.id))}
            >
              <Icon name="pin" size={13} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              aria-label={favorite ? tr('sessions.unfavorite') : tr('sessions.favorite')}
              title={favorite ? tr('sessions.unfavorite') : tr('sessions.favorite')}
              className={`grid h-[22px] w-[22px] place-items-center rounded ${favorite ? 'text-warn' : 'text-ink-3 hover:text-ink'}`}
              onClick={() => applyMarks(toggleFavorite(marks, session.id))}
            >
              <Icon name="star" size={13} strokeWidth={1.6} filled={favorite} />
            </button>
            <button
              type="button"
              aria-label={tr('sessions.delete')}
              title={tr('sessions.delete')}
              className="grid h-[22px] w-[22px] place-items-center rounded text-ink-3 hover:text-bad"
              onClick={() => setConfirmId(session.id)}
            >
              <Icon name="trash" size={13} strokeWidth={1.6} />
            </button>
          </div>
        )}
      </div>
    );
  };
  const task = snapshot.task;
  const metrics = Object.entries(snapshot.metrics);

  /*
    There is no collapsed branch here any more. This column now closes to zero width and
    the permanent `IconRail` outside it owns re-opening, searching and the account entry —
    so keeping a 48px strip here as well would have put two re-open controls side by side
    for one panel. See `railWidth`.
  */
  return (
    <aside
      data-rail="left"
      /*
        The column keeps its cell in the grid when closed — dropping the element would
        shuffle the remaining children into the wrong columns — so it collapses to zero
        width instead. Zero width still leaves its buttons in the tab order, which is a
        keyboard user tabbing into nothing; `inert` takes the subtree out of both the tab
        order and the accessibility tree, and the icon rail outside is what re-opens it.
      */
      inert={collapsed || undefined}
      // The border goes with the column. At zero width a 1px right border still paints, so
      // a closed column would draw a hairline beside the icon rail's own — two rules 1px
      // apart, reading as one heavy line.
      className={`flex h-full w-full min-w-0 flex-col overflow-hidden bg-base ${
        collapsed ? '' : 'border-r border-line'
      }`}
    >
      {/*
        Reserved: Hermes puts a nav strip (new / search / connections / agents / models)
        above the conversation list here. It is not built yet on purpose — the list gets
        the whole column instead of sharing it with placeholder chrome. When the strip
        lands it goes directly below this line, and the header below it becomes its
        trailing action group.
      */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-[13px] font-semibold text-ink">{tr('sessions.history')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-new-session
            className="inline-flex items-center gap-0.5 rounded-md bg-accent px-1.5 py-[2px] text-[11px] font-medium leading-4 text-base hover:bg-accent-2"
            onClick={newSession}
          >
            <span className="text-[13px] leading-none">+</span>
            新建
          </button>
          <button
            type="button"
            aria-label={tr('sessions.collapse')}
            title={tr('sessions.collapse')}
            className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
            onClick={() => setLocalPrefs({ leftCollapsed: true })}
          >
            <Icon name="collapse" size={13} />
          </button>
        </div>
      </div>
      <label className="shrink-0 px-2 pb-1.5">
        <span className="sr-only">{tr('sessions.search')}</span>
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2 py-1.5">
          <Icon name="search" size={12} className="shrink-0 text-ink-3" />
          <input
            data-session-search
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr('sessions.search')}
            className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
      </label>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {listed.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11.5px] leading-5 text-ink-3">
            {tr('sessions.empty')}
            <br />
            {tr('sessions.empty.hint')}
          </div>
        ) : (
          <>
            {pinnedRows.length > 0 ? (
              <div>
                <p className="px-1 pb-0.5 pt-1 text-[10px] tracking-wide text-ink-3">{tr('sessions.pin')}</p>
                {pinnedRows.map(renderSession)}
              </div>
            ) : null}
            {recentRows.length > 0 ? (
              <div>
                {pinnedRows.length > 0 ? (
                  <p className="px-1 pb-0.5 pt-2 text-[10px] tracking-wide text-ink-3">{tr('sessions.recent')}</p>
                ) : null}
                {recentRows.map(renderSession)}
              </div>
            ) : null}
          </>
        )}
      </div>

      {(!task || task.checkpoints.length === 0) ? null : null}
      <details className="max-h-[40%] shrink-0 overflow-y-auto border-t border-line hidden">
        <summary className="cursor-pointer px-3 py-2 text-[11px] text-ink-3 hover:text-ink">{tr('workspace.title')}</summary>
      <section>
        <div className="px-3 pb-3">
          <p className="break-all font-mono text-[11px] text-ink-2">{snapshot.session?.workspace ?? '—'}</p>
        </div>
      </section>

      <section className="border-t border-line">
        <SectionHeader
          icon="layers"
          title={tr('provider.title')}
          right={
            snapshot.provider.fallbacks.length ? (
              <Chip tone="warn">{snapshot.provider.fallbacks.length} fallback</Chip>
            ) : snapshot.provider.connected === true ? (
              <Chip tone="ok">{tr('provider.connected')}</Chip>
            ) : (
              <Chip tone="muted">{tr('provider.primary')}</Chip>
            )
          }
        />
        <div className="space-y-1.5 px-3 pb-3">
          {snapshot.provider.activeProvider ? (
            <>
              <p className="font-mono text-[11px] text-ink-2">
                {snapshot.provider.activeProvider} <span className="text-ink-3">·</span> {snapshot.provider.activeModel}
              </p>
              {snapshot.provider.reason ? <p className="text-[10.5px] text-ink-3">{tr('provider.chosenBecause')} {snapshot.provider.reason}</p> : null}
            </>
          ) : (
            <p className="text-[11.5px] text-ink-3">
              {status === 'connecting' ? tr('provider.connecting') : tr('provider.none')}
            </p>
          )}
          <button
            type="button"
            className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
            onClick={() => setSettingsOpen(true)}
          >
            {tr('provider.configureKeys')}
          </button>
          {snapshot.provider.fallbacks.length ? (
            <ul className="space-y-1">
              {snapshot.provider.fallbacks.map((f, i) => (
                <li key={`${f.at}-${i}`} className="rounded border border-warn/25 bg-warn/8 px-2 py-1">
                  <p className="font-mono text-[10.5px] text-warn">
                    {tr('provider.depth')} {f.depth}: {f.from} → {f.to}
                  </p>
                  <p className="text-[10.5px] text-ink-3">{f.reason}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[10.5px] text-ink-3">
            {snapshot.provider.chain?.length
              ? `${tr('provider.chain')} ${snapshot.provider.chain.join(' → ')}`
              : null}
          </p>
        </div>
      </section>

      <section className="border-t border-line">
        <SectionHeader
          icon="undo"
          title={tr('checkpoints.title')}
          right={<span className="font-mono text-[10.5px] text-ink-3">{task?.checkpoints.length ?? 0}</span>}
        />
        <div className="space-y-1 px-3 pb-3">
          {task && task.checkpoints.length > 0
            ? [...task.checkpoints].reverse().map((cp) => (
              <div key={cp.id} className="flex items-start gap-2 rounded border border-line bg-base/40 px-2 py-1.5">
                <Icon name="branch" size={12} className="mt-[2px] shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10.5px] text-ink-2">
                    {shortId(cp.id)} · step {cp.stepIdx + 1}
                  </p>
                  <p className="truncate text-[10.5px] text-ink-3" title={cp.ctxSummary}>
                    {cp.ctxSummary}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dispatch(makeCommand('rollback_step', { taskId: task.id, checkpointId: cp.id }))}
                  className="shrink-0 rounded border border-line px-1.5 py-[1px] text-[10px] text-ink-3 hover:border-warn/40 hover:text-warn"
                >
                  {tr('checkpoints.restore')}
                </button>
              </div>
            ))
            : null}
        </div>
      </section>

      <section className="border-t border-line">
        <SectionHeader icon="gauge" title={tr('metrics.title')} />
        <div className="px-3 pb-3">
          {metrics.length === 0 ? (
            <p className="text-[11.5px] text-ink-3">{tr('metrics.empty')}</p>
          ) : (
            <dl className="space-y-1">
              {metrics.map(([name, value]) => (
                <div key={name} className="flex items-baseline justify-between gap-2">
                  <dt className="min-w-0 truncate font-mono text-[10.5px] text-ink-3">{name}</dt>
                  <dd className="shrink-0 font-mono text-[11px] text-ink-2">{count(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>
      </details>
    </aside>
  );
}