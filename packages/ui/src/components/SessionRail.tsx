/**
 * Left rail (260px) — where the run lives: session, workspace, provider path, metrics and
 * the checkpoints you can roll back to.
 *
 * Checkpoints are placed here rather than in the conversation because rollback is a
 * *workspace-level* operation: the user needs to see every restore point at once, not
 * only the one attached to the step they happen to be reading.
 * @module
 */

import type { ReactNode } from 'react';

import { count, shortId } from '../lib/format.js';
import { makeCommand } from '../state/store.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { Chip, Icon, SectionHeader } from './primitives.js';

export function SessionRail(): ReactNode {
  const { snapshot, sessions, activeSessionId, status, dispatch } = useUiState();
  const collapsed = useUiStore((s) => s.localPrefs.leftCollapsed);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const task = snapshot.task;
  const metrics = Object.entries(snapshot.metrics);

  if (collapsed) {
    return (
      <aside data-rail="left" className="flex h-full w-full flex-col items-center gap-3 overflow-hidden border-r border-line bg-elevated/30 py-3">
        <button
          type="button"
          title="Expand sessions"
          aria-label="Expand sessions"
          className="group relative grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          onClick={() => setLocalPrefs({ leftCollapsed: false })}
        >
          <Icon name="expand" size={16} />
          <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded border border-line bg-panel px-2 py-1 text-[11px] text-ink group-hover:block">
            Expand sessions
          </span>
        </button>
        <span className="font-mono text-[10px] text-ink-3" title={`${sessions.length} sessions`}>
          {sessions.length}
        </span>
      </aside>
    );
  }

  return (
    <aside data-rail="left" className="flex h-full w-full min-w-0 flex-col overflow-y-auto border-r border-line bg-elevated/30">
      <SectionHeader
        icon="camellia"
        title="Sessions"
        right={
          <span className="flex items-center gap-1">
            <span className="font-mono text-[10.5px] text-ink-3">{sessions.length}</span>
            <button
              type="button"
              aria-label="Collapse sessions"
              title="Collapse sessions"
              className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
              onClick={() => setLocalPrefs({ leftCollapsed: true })}
            >
              <Icon name="collapse" size={13} />
            </button>
          </span>
        }
      />
      <div className="space-y-1 px-2 pb-3">
        {sessions.length === 0 ? (
          <p className="px-1 text-[11.5px] text-ink-3">No sessions in this workspace yet.</p>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                type="button"
                className={`w-full rounded-md border px-2 py-1.5 text-left ${
                  active ? 'border-accent/35 bg-accent/8' : 'border-transparent hover:border-line hover:bg-hover/40'
                }`}
              >
                <p className={`truncate text-[11.5px] ${active ? 'text-ink' : 'text-ink-2'}`}>{session.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-ink-3">
                  <span>{session.provider}</span>
                  <span>·</span>
                  <span className="truncate">{session.model}</span>
                </p>
              </button>
            );
          })
        )}
      </div>

      <section className="border-t border-line">
        <SectionHeader icon="file" title="Workspace" />
        <div className="px-3 pb-3">
          <p className="break-all font-mono text-[11px] text-ink-2">{snapshot.session?.workspace ?? '—'}</p>
        </div>
      </section>

      <section className="border-t border-line">
        <SectionHeader
          icon="layers"
          title="Provider path"
          right={
            snapshot.provider.fallbacks.length ? (
              <Chip tone="warn">{snapshot.provider.fallbacks.length} fallback</Chip>
            ) : (
              <Chip tone="muted">primary</Chip>
            )
          }
        />
        <div className="space-y-1.5 px-3 pb-3">
          {snapshot.provider.activeProvider ? (
            <>
              <p className="font-mono text-[11px] text-ink-2">
                {snapshot.provider.activeProvider} <span className="text-ink-3">·</span> {snapshot.provider.activeModel}
              </p>
              {snapshot.provider.reason ? <p className="text-[10.5px] text-ink-3">chosen because: {snapshot.provider.reason}</p> : null}
            </>
          ) : (
            <p className="text-[11.5px] text-ink-3">No provider selected yet.</p>
          )}
          {snapshot.provider.fallbacks.length ? (
            <ul className="space-y-1">
              {snapshot.provider.fallbacks.map((f, i) => (
                <li key={`${f.at}-${i}`} className="rounded border border-warn/25 bg-warn/8 px-2 py-1">
                  <p className="font-mono text-[10.5px] text-warn">
                    depth {f.depth}: {f.from} → {f.to}
                  </p>
                  <p className="text-[10.5px] text-ink-3">{f.reason}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[10.5px] text-ink-3">chain: OpenCode Zen → OpenRouter → Ollama</p>
        </div>
      </section>

      <section className="border-t border-line">
        <SectionHeader
          icon="undo"
          title="Checkpoints"
          right={<span className="font-mono text-[10.5px] text-ink-3">{task?.checkpoints.length ?? 0}</span>}
        />
        <div className="space-y-1 px-3 pb-3">
          {!task || task.checkpoints.length === 0 ? (
            <p className="text-[11.5px] text-ink-3">Restore points appear after each completed step.</p>
          ) : (
            [...task.checkpoints].reverse().map((cp) => (
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
                  restore
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="border-t border-line">
        <SectionHeader icon="gauge" title="Metrics" />
        <div className="px-3 pb-3">
          {metrics.length === 0 ? (
            <p className="text-[11.5px] text-ink-3">No metrics emitted.</p>
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

      <div className="mt-auto border-t border-line px-3 py-2">
        <p className="flex items-center gap-1.5 text-[10px] text-ink-3">
          <span className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'bg-accent' : 'bg-ink-3'}`} />
          keys in ~/.camelia · zero telemetry · Apache-2.0
        </p>
      </div>
    </aside>
  );
}