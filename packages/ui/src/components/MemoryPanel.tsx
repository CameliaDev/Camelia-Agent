/**
 * Memory panel — the visible half of the memory lifecycle (Iteration 22).
 *
 * Four layers, value scores, the recall-noise health chip, the reactivation
 * queue and the forgetting audit trail. Every number here is engine data: the
 * list, the forget log, the health snapshot and the score decomposition all come
 * from `listMemories / listForgetLog / listReactivationDue / getMemoryHealth`
 * commands answered by `EngineServer → SqliteSessionStore`. Interventions leave
 * as commands (`markMemoryIncorrect` / `forgetMemory` / `promoteMemory`) and
 * surface through the same bus events as task-driven ones.
 *
 * Nothing is decorative and nothing disappears when empty — the panel always
 * says what exists and what does not, so the capability is visible even when
 * unused.
 * @module
 */

import { useEffect, useState, type ReactNode } from 'react';

import type { MemoryLayer } from '@camelia/core';
import type { MemoryView } from '@camelia/agent/view';

import { clock, pct } from '../lib/format.js';
import { useUiStore } from '../state/UiProvider.js';
import { Chip, Icon, SectionHeader } from './primitives.js';

const LAYER_TABS: Array<{ id: MemoryLayer | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'working', label: 'Work' },
  { id: 'short', label: 'Short' },
  { id: 'long', label: 'Long' },
  { id: 'procedural', label: 'Proc' },
];

const LAYER_TONE: Record<MemoryLayer, 'muted' | 'accent' | 'info' | 'warn' | 'ok'> = {
  working: 'accent',
  short: 'info',
  long: 'muted',
  procedural: 'ok',
};

/** Round a 0..1 score to two decimals without the float noise. */
function score(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** The value decomposition — importance × recency × correctness = strength. */
function ValueLine({ item }: { item: MemoryView }): ReactNode {
  const formula = `${score(item.importance)} × ${score(item.recency)} × ${score(item.correctness)}`;
  const tone = item.correctness === 0 ? 'text-bad' : 'text-ink';
  return (
    <p className="mt-0.5 flex items-baseline gap-1.5 font-mono text-[10px] text-ink-3">
      <span className={`text-[11px] font-semibold ${tone}`}>{score(item.strength)}</span>
      <span className="text-ink-3/70">= imp {formula}</span>
      <span className="ml-auto">{item.hits} hits</span>
    </p>
  );
}

/** The evidence behind correctness = 1 — which task's verification passed. */
function EvidenceLine({ item }: { item: MemoryView }): ReactNode {
  if (!item.evidence) return null;
  return (
    <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-ok">
      <Icon name="check" size={10} />
      <span className="truncate">
        validated by {item.evidence.taskId} ({item.evidence.verdict})
      </span>
    </p>
  );
}

function MemoryRow({
  item,
  onIncorrect,
  onForget,
  onPromote,
}: {
  item: MemoryView;
  onIncorrect: (id: string) => void;
  onForget: (id: string) => void;
  onPromote: (id: string) => void;
}): ReactNode {
  const correctnessTone = item.correctness === 0 ? 'bad' : item.correctness >= 1 ? 'ok' : 'muted';
  return (
    <li className="rounded-md border border-line bg-base/40 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <Chip tone={LAYER_TONE[item.layer]}>{item.layer}</Chip>
        <Chip tone="muted">{item.kind}</Chip>
        <Chip tone={correctnessTone}>
          {item.correctness === 0 ? 'known-bad' : item.correctness >= 1 ? 'validated' : 'unproven'}
        </Chip>
        <span className="ml-auto flex items-center gap-1.5">
          {item.layer === 'short' ? (
            <button
              type="button"
              onClick={() => onPromote(item.id)}
              title="Promote to long-term"
              className="rounded border border-line px-1.5 py-[1px] font-mono text-[10px] text-ink-3 hover:border-ok/40 hover:text-ok"
            >
              promote
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onIncorrect(item.id)}
            title="Mark as incorrect — stops recall until evidence clears it"
            className="rounded border border-line px-1.5 py-[1px] font-mono text-[10px] text-ink-3 hover:border-warn/40 hover:text-warn"
          >
            incorrect
          </button>
          <button
            type="button"
            onClick={() => onForget(item.id)}
            title="Forget — recorded in the forget log"
            className="rounded border border-line px-1.5 py-[1px] font-mono text-[10px] text-ink-3 hover:border-bad/40 hover:text-bad"
          >
            forget
          </button>
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-ink-2">{item.content}</p>
      <ValueLine item={item} />
      <EvidenceLine item={item} />
    </li>
  );
}

function DueQueue({ items }: { items: MemoryView[] }): ReactNode {
  return (
    <div className="mt-1">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        <Icon name="clock" size={11} />
        due for reactivation
        <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-ink-3/80">
          {items.length}
        </span>
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-3">Nothing is due. The spaced-repetition queue is quiet.</p>
      ) : (
        <ul data-testid="due-queue" className="mt-1 space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-baseline gap-1.5 font-mono text-[10.5px] text-ink-2">
              <span className="shrink-0 text-ok">{score(item.strength)}</span>
              <span className="min-w-0 truncate">{item.content}</span>
              {item.nextReviewAt ? <span className="ml-auto shrink-0 text-ink-3/70">{clock(item.nextReviewAt)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ForgetLogSection({
  entries,
}: {
  entries: Array<{ id: string; contentSnippet: string; reason: string; value: number; createdAt: number }>;
}): ReactNode {
  return (
    <div className="mt-2.5">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        <Icon name="undo" size={11} />
        forget log
        <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-ink-3/80">
          {entries.length}
        </span>
      </p>
      {entries.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-3">Nothing has been forgotten. Evictions and manual forgets land here.</p>
      ) : (
        <ul data-testid="forget-log" className="mt-1 space-y-1">
          {entries.slice(0, 4).map((entry) => (
            <li key={entry.id} className="rounded border border-line/70 bg-base/30 px-2 py-1">
              <p className="truncate text-[10.5px] text-ink-3">{entry.contentSnippet}</p>
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] text-ink-3/80">
                <span className="text-warn">{entry.reason}</span>
                <span>value {score(entry.value)}</span>
                <span className="ml-auto">{clock(entry.createdAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MemoryPanel(): ReactNode {
  const memory = useUiStore((s) => s.memory);
  const actions = useUiStore((s) => s.memoryActions);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    void actions.load();
  }, [actions]);

  const layer = memory.layerFilter;
  const visible = layer === 'all' ? memory.items : memory.items.filter((item) => item.layer === layer);
  const noiseRate = memory.health?.recallNoise.noiseRate;

  return (
    <section className="border-b border-line">
      <SectionHeader
        icon="layers"
        title="Memory"
        right={
          <span className="flex items-center gap-1.5">
            {noiseRate !== undefined ? (
              <Chip tone={noiseRate > 0.2 ? 'warn' : 'ok'} title="cross-session recall-noise rate (downgraded hits / total hits)">
                noise {pct(noiseRate)}
              </Chip>
            ) : (
              <Chip tone="muted">noise —</Chip>
            )}
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="text-ink-3 hover:text-ink"
              aria-label={open ? 'Collapse memory panel' : 'Expand memory panel'}
            >
              <Icon name="chevron" size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          </span>
        }
      />
      {open ? (
        <div className="space-y-2.5 px-3 pb-3">
          <div className="flex gap-1">
            {LAYER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => actions.setLayer(tab.id)}
                className={`rounded border px-1.5 py-[2px] font-mono text-[10px] ${
                  layer === tab.id ? 'border-accent/40 bg-accent/10 text-ink' : 'border-line text-ink-3 hover:text-ink-2'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {memory.error ? (
            <p className="text-[11.5px] text-bad">{memory.error}</p>
          ) : memory.loading && visible.length === 0 ? (
            <p className="text-[11.5px] text-ink-3">Loading memories from the engine…</p>
          ) : visible.length === 0 ? (
            <p className="text-[11.5px] text-ink-3">
              {memory.items.length === 0
                ? 'No memories yet. Reflections during a task write them here, scored by value.'
                : `No ${layer} memories.`}
            </p>
          ) : (
            <ul data-testid="memory-list" className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
              {visible.map((item) => (
                <MemoryRow
                  key={item.id}
                  item={item}
                  onIncorrect={(id) => void actions.markIncorrect(id)}
                  onForget={(id) => void actions.forget(id)}
                  onPromote={(id) => void actions.promote(id)}
                />
              ))}
            </ul>
          )}

          <DueQueue items={memory.reactivationDue} />
          <ForgetLogSection entries={memory.forgetLog} />
        </div>
      ) : null}
    </section>
  );
}
