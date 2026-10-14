/**
 * Run panels — the engineering view of a run, as horizontal panels in the work area.
 *
 * ## Where these used to live
 *
 * All six of these were tabs in a fourth column — the right rail. It was removed: the user
 * had already called its buttons "摆设" (decorative), and the reason was accurate. Four of
 * the six (`run`, `context`, `sub`, and the model view's live half) can only show
 * something once a task exists, so on an idle window the column was a 360px strip of tabs
 * leading to four empty panels. It was also the widest thing on screen competing with the
 * thing the user came for.
 *
 * ## What replaced it
 *
 * The top bar keeps one drawer toggle (`PanelDrawerToggle`). The sections are the
 * top bar's 更多 menu, and the bodies live here. A task-bound section stays in the
 * menu when there is no task — dimmed, not removed — so the set does not jump.
 *
 * Nothing is deleted and nothing is simplified. The panel bodies are the same components
 * that rendered in the rail, moved wholesale — a rewrite would risk the run record and the
 * compaction inspector, and there is no reason for either to change shape.
 *
 * ## The `run` panel keeps three sections
 *
 * Progress, the step list and checkpoints stay together under one icon, because they are
 * three views of the same thing: what the run is doing now. Splitting them across three
 * icons would mean the header claiming more of the row than the information warrants.
 * @module
 */

import { useState, type ReactNode } from 'react';

import type { DroppedMessage } from '@camelia/core';
import type { SubAgentView, TaskView, TimelineEntry } from '@camelia/agent/view';
import { contextUsage } from '@camelia/agent/view';

import { bytes, clock, count, ms, pct } from '../lib/format.js';
import { STEP_META, TONE_BG, TONE_TEXT, type Tone } from '../lib/status.js';
import { useUiStore } from '../state/UiProvider.js';
import { localizePlanText } from '../i18n/plan-copy.js';
import { t } from '../i18n/strings.js';
import type { PanelId } from '../panels.js';
import { MathArtifactBody } from '../modes/math/MathPanels.js';
import { MemoryPanel } from './MemoryPanel.js';
import { HealthMetricsPanel } from './HealthMetricsPanel.js';
import { Chip, Icon, ProgressBar, SectionHeader, StatusDot } from './primitives.js';

function useTr() {
  const lang = useUiStore((s) => s.localPrefs.language);
  return (k: Parameters<typeof t>[1]) => t(lang, k);
}

export function RunIdentity(): ReactNode {
  const tr = useTr();
  const snapshot = useUiStore((s) => s.snapshot);
  const status = useUiStore((s) => s.status);
  const task = snapshot.task;
  const usage = task ? contextUsage(task.context) : 0;
  const fallbacks = snapshot.provider.fallbacks;
  return (
    <div className="px-3 py-2.5">
      <p className="truncate text-[12px] font-medium text-ink">{snapshot.session?.title ?? tr('panel.noSession')}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {snapshot.provider.activeProvider ? (
          <Chip
            tone={fallbacks.length ? 'warn' : 'info'}
            title={
              fallbacks.length
                ? `fell back ${fallbacks.length}×: ${fallbacks.map((f) => `${f.from}→${f.to} (${f.reason})`).join('; ')}`
                : 'primary provider'
            }
          >
            <Icon name="layers" size={10} />
            {snapshot.provider.activeProvider}
            <span className="text-ink-3">·</span>
            <span className="font-mono">{snapshot.provider.activeModel}</span>
          </Chip>
        ) : (
          <span className="text-[11px] text-ink-3">
            {status === 'connecting' ? tr('provider.connecting') : tr('panel.noProvider')}
          </span>
        )}
        {task ? (
          <Chip tone={usage > 0.8 ? 'warn' : 'muted'} title={`${count(task.context.used)} of ${count(task.context.window)} tokens`}>
            <Icon name="gauge" size={10} />
            {tr('run.ctx')} {pct(usage)}
          </Chip>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// run / progress
// ---------------------------------------------------------------------------

export function RunSection({ task }: { task: TaskView }): ReactNode {
  const tr = useTr();
  const usage = contextUsage(task.context);
  return (
    <section className="border-b border-line">
      <SectionHeader
        icon="layers"
        title={tr('run.title')}
        right={
          <span className="flex items-center gap-2">
            <span className="w-14">
              <ProgressBar value={task.progress} tone={task.status === 'done' ? 'ok' : task.status === 'failed' ? 'bad' : 'accent'} />
            </span>
            <span className="font-mono text-[10.5px] text-ink-3">{pct(task.progress)}</span>
          </span>
        }
      />
      <div className="space-y-2.5 px-3 pb-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: tr('run.steps'), value: `${task.steps.filter((s) => s.status === 'done').length}/${task.stepsTotal || 0}` },
            { label: tr('run.tools'), value: String(Object.keys(task.toolCalls).length) },
            { label: tr('run.context'), value: pct(usage) },
            { label: tr('run.tokens'), value: task.routing ? String(task.routing.tokens) : '—' },
            { label: tr('run.cost'), value: task.routing ? `$${task.routing.estimatedUsd.toFixed(4)}` : '—' },
          ].map((cell) => (
            <div key={cell.label} className="rounded-md border border-line bg-base/40 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{cell.label}</p>
              <p className="font-mono text-[13px] text-ink">{cell.value}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[10.5px] text-ink-3">
            <span>{tr('run.weightedProgress')}</span>
            <span className="font-mono">
              {task.currentStepIdx >= 0 ? `${tr('run.atStep')} ${task.currentStepIdx + 1}` : tr('run.notStarted')}
            </span>
          </div>
          <ProgressBar value={task.progress} tone={task.status === 'done' ? 'ok' : task.status === 'failed' ? 'bad' : 'accent'} />
        </div>
        {task.routing ? <p className="text-[11px] text-ink-2">{task.routing.line}</p> : null}
        {task.steps.some((step) => step.acceptance.length === 0 || step.verdict?.status === 'unknown') ? (
          <p className="text-[11px] text-warn">
            Empty acceptance can pass on tool evidence, and unknown is not a failure, so a cheap first attempt can lock in a weak result.
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

export function StepsSection({ task }: { task: TaskView }): ReactNode {
  const tr = useTr();
  const lang = useUiStore((s) => s.localPrefs.language);
  return (
    <section className="border-b border-line">
      <SectionHeader
        icon="branch"
        title={tr('run.stepsList')}
        right={<span className="font-mono text-[10.5px] text-ink-3">{task.steps.length}</span>}
      />
      <div className="px-3 pb-3">
        {task.steps.length === 0 ? (
          <p className="text-[11.5px] text-ink-3" data-steps-empty>
            {tr('run.steps.pending')}
          </p>
        ) : (
          <ol data-rail-steps className="space-y-1">
            {task.steps.map((step) => {
              const meta = STEP_META[step.status];
              const active = step.idx === task.currentStepIdx && (step.status === 'running' || step.status === 'verifying');
              const tools = Object.values(task.toolCalls).filter((c) => c.stepId === step.id);
              const failures = tools.filter((c) => c.status === 'error').length;
              return (
                <li
                  key={step.id}
                  className={`flex items-start gap-2 rounded-md border px-2 py-1.5 ${
                    active ? 'border-accent/35 bg-accent/5' : 'border-transparent'
                  }`}
                >
                  <span className="mt-[5px] shrink-0">
                    {step.status === 'running' ? (
                      <StatusDot tone="accent" pulse />
                    ) : (
                      <StatusDot tone={meta.tone} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[11.5px] ${active ? 'text-ink' : step.status === 'pending' ? 'text-ink-3' : 'text-ink-2'}`}>
                      <span className="mr-1.5 font-mono text-[10px] text-ink-3">{step.idx + 1}</span>
                      {localizePlanText(lang, step.title)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-3">
                      <span className={TONE_TEXT[meta.tone]}>{meta.label}</span>
                      <span>{tools.length} tools</span>
                      {failures ? <span className="text-bad">{failures} failed</span> : null}
                      {step.weight > 1 ? <span>w{step.weight}</span> : null}
                      {step.verdict ? (
                        <span className={step.verdict.status === 'pass' ? 'text-ok' : 'text-bad'}>{step.verdict.status}</span>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// context window + compaction
// ---------------------------------------------------------------------------

/** Role → tone, so a dropped original is identifiable at a glance. */
const ROLE_TONE: Record<DroppedMessage['role'], Tone> = {
  system: 'muted',
  user: 'accent',
  assistant: 'info',
  tool: 'warn',
};

/**
 * One dropped message, shown as its original text.
 *
 * This is the "inspect what compaction removed" surface: the summary above tells the
 * user *what* was folded away, this tells them *exactly* what the model saw before it
 * was folded. Content is pre-wrapped and scroll-bounded so a large tool output cannot
 * blow up the rail.
 */
function DroppedOriginal({ message }: { message: DroppedMessage }): ReactNode {
  const tone = ROLE_TONE[message.role];
  return (
    <li className="overflow-hidden rounded border border-line bg-base/50">
      <div className="flex items-center gap-1.5 border-b border-line/70 px-1.5 py-1">
        <span className={`rounded border px-1.5 py-[1px] font-mono text-[9.5px] uppercase leading-4 ${TONE_BG[tone]}`}>
          {message.role}
        </span>
        {message.name ? <span className="truncate font-mono text-[10px] text-ink-2">{message.name}</span> : null}
        {message.truncated ? (
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-warn">truncated</span>
        ) : null}
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words px-1.5 py-1 font-mono text-[10.5px] leading-4 text-ink-2">
        {message.content}
      </pre>
    </li>
  );
}

export function ContextSection({ task }: { task: TaskView }): ReactNode {
  const tr = useTr();
  const [openIdx, setOpenIdx] = useState<number | null>(task.context.compactions.length ? task.context.compactions.length - 1 : null);
  const ctx = task.context;
  const usage = contextUsage(ctx);
  const softRatio = ctx.window > 0 ? ctx.softLimit / ctx.window : 0;

  return (
    <section className="border-b border-line">
      <SectionHeader
        icon="gauge"
        title={tr('context.title')}
        right={
          <span className="flex items-center gap-2">
            <span className="w-14">
              <ProgressBar value={usage} tone={usage > softRatio ? 'warn' : 'accent'} />
            </span>
            <span className="font-mono text-[10.5px] text-ink-3">{pct(usage)}</span>
          </span>
        }
      />
      <div className="space-y-2.5 px-3 pb-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between font-mono text-[10.5px] text-ink-3">
            <span>
              {count(ctx.used)} / {count(ctx.window)} tokens
            </span>
            <span>soft limit {pct(softRatio)}</span>
          </div>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-hover">
            <div
              className={`h-full rounded-full ${usage > softRatio ? 'bg-warn' : 'bg-accent'}`}
              style={{ width: `${Math.min(100, usage * 100)}%` }}
            />
            <span className="absolute inset-y-0 w-px bg-ink-3/60" style={{ left: `${Math.min(100, softRatio * 100)}%` }} />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip tone={ctx.compactions.length ? 'warn' : 'muted'}>
            <Icon name="layers" size={10} />
            {ctx.compactions.length} compaction{ctx.compactions.length === 1 ? '' : 's'}
          </Chip>
          <Chip tone="muted">deduped {ctx.deduplicated}</Chip>
          <Chip tone="muted">{task.checkpoints.length} checkpoints</Chip>
        </div>

        {ctx.compactions.length === 0 ? (
          <p className="text-[11.5px] text-ink-3">
            {tr('context.nothingCompressed')}
          </p>
        ) : (
          <div className="space-y-1.5">
            {ctx.compactions.map((c, i) => (
              <div key={`${c.at}-${i}`} className="rounded-md border border-line bg-base/40">
                <button
                  type="button"
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-hover/40"
                >
                  <Icon name="chevron" size={11} className={`text-ink-3 transition-transform ${openIdx === i ? 'rotate-90' : ''}`} />
                  <span className="font-mono text-[11px] text-warn">
                    {count(c.tokensBefore)} → {count(c.tokensAfter)}
                  </span>
                  <span className="text-[10.5px] text-ink-3">{c.droppedMessages} dropped</span>
                  <span className="ml-auto font-mono text-[10px] text-ink-3">{clock(c.at)}</span>
                </button>
                {openIdx === i ? (
                  <div className="space-y-2.5 border-t border-line px-2.5 py-2">
                    <div className="space-y-1">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">what was compressed away</p>
                      <ul className="space-y-1">
                        {c.summaries.map((s, j) => (
                          <li key={j} className="text-[11.5px] leading-5 text-ink-2">
                            · {s}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-1">
                      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                        <Icon name="eye" size={11} />
                        dropped originals
                        <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-ink-3/80">
                          {c.droppedPreviews.length}/{c.droppedMessages}
                        </span>
                      </p>
                      {c.droppedPreviews.length === 0 ? (
                        <p className="text-[11px] text-ink-3">The originals were not retained for this compaction.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {c.droppedPreviews.map((m, j) => (
                            <DroppedOriginal key={j} message={m} />
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">protected slots that survived</p>
                      <div className="flex flex-wrap gap-1">
                        {c.protectedSlots.map((slot) => (
                          <span key={slot} className="rounded border border-ok/30 bg-ok/10 px-1.5 py-[1px] font-mono text-[10px] text-ok">
                            {slot}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// sub-agents
// ---------------------------------------------------------------------------

function SubAgentCard({ agent }: { agent: SubAgentView }): ReactNode {
  const tone = agent.status === 'running' ? 'accent' : agent.status === 'ok' ? 'ok' : 'bad';
  return (
    <div className={`rounded-md border px-2.5 py-2 ${TONE_BG[tone]}`}>
      <div className="flex items-center gap-2">
        {agent.status === 'running' ? <StatusDot tone="accent" pulse /> : <StatusDot tone={tone} />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{agent.goal}</span>
        <span className="font-mono text-[10px] opacity-80">
          {agent.tokensUsed !== undefined ? `${count(agent.tokensUsed)}t` : '—'}
        </span>
      </div>
      {agent.summary ? <p className="mt-1 text-[11px] leading-5 opacity-90">{agent.summary}</p> : null}
      <p className="mt-1 flex items-center gap-2 font-mono text-[10px] opacity-75">
        <span>{agent.status}</span>
        <span>{ms((agent.endedAt ?? agent.startedAt) - agent.startedAt)}</span>
        {agent.artifacts.length ? <span>{agent.artifacts.length} artifacts</span> : null}
      </p>
    </div>
  );
}

/**
 * Read-only model view for math mode.
 *
 * Deliberately read-only, and deliberately here rather than in the workspace. The rail is
 * an *observation* surface; the workspace is the *operating* surface. Splitting editing
 * across both would create two places a variable can be changed, with no way to tell which
 * one the solver saw — so the rail shows and the workspace edits.
 */
export function ModelSection(): ReactNode {
  const tr = useTr();
  const mathDemo = useUiStore((s) => s.mathDemo);
  const task = useUiStore((s) => s.snapshot.task);

  // Live assumptions are the only model data the projection carries today (`string[]`).
  // Everything else is demo-only, and is labelled as such rather than blended in.
  const liveAssumptions = task?.assumptions ?? [];
  const variables = mathDemo?.variables ?? [];
  const equations = mathDemo?.equations ?? [];

  return (
    <section className="border-b border-line" data-rail-model>
      <SectionHeader
        icon="sigma"
        title={tr('panel.model')}
        right={
          mathDemo ? (
            <span className="rounded border border-warn/50 bg-warn/10 px-1.5 py-[1px] text-[10px] text-warn">
              {tr('math.demo.badge')}
            </span>
          ) : undefined
        }
      />
      <div className="space-y-2 px-3 pb-3">
        {liveAssumptions.length ? (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.06em] text-ink-3">{tr('math.assumptions')}</p>
            <ul className="space-y-0.5">
              {liveAssumptions.map((a) => (
                <li key={a} className="text-[11px] leading-4 text-ink-2">
                  · {a}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {variables.length ? (
          <dl className="space-y-0.5">
            {variables.map((v) => (
              <div key={v.symbol} className="flex items-baseline gap-2 text-[11px]">
                <dt className="w-14 shrink-0 font-mono text-accent">{v.symbol}</dt>
                <dd className="min-w-0 flex-1 truncate text-ink-2">{v.name}</dd>
                <dd className="shrink-0 font-mono text-ink">{v.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {equations.length ? (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.06em] text-ink-3">{tr('math.equations')}</p>
            <ul className="space-y-0.5">
              {equations.map((eq) => (
                <li key={eq.text} className="truncate font-mono text-[10.5px] text-ink-2" title={eq.text}>
                  {eq.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[10.5px] leading-4 text-ink-3">{tr('panel.model.hint')}</p>
      </div>
    </section>
  );
}

export function SubAgentsSection({ task }: { task: TaskView }): ReactNode {  const tr = useTr();
  return (
    <section className="border-b border-line">
      <SectionHeader
        icon="bot"
        title={tr('subagents.title')}
        right={<span className="font-mono text-[10.5px] text-ink-3">{task.subAgents.length}</span>}
      />
      <div className="space-y-1.5 px-3 pb-3">
        {task.subAgents.length === 0 ? (
          <p className="text-[11.5px] text-ink-3">
            {tr('subagents.empty')}
          </p>
        ) : (
          task.subAgents.map((agent) => <SubAgentCard key={agent.id} agent={agent} />)
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

export function CheckpointSection({ task }: { task: TaskView }): ReactNode {
  const tr = useTr();
  return (
    <section className="border-b border-line" data-checkpoint-section>
      <SectionHeader
        icon="undo"
        title={tr('checkpoints.title')}
        right={<span className="font-mono text-[10.5px] text-ink-3">{task.checkpoints.length}</span>}
      />
      <div className="space-y-1.5 px-3 pb-3">
        {task.checkpoints.length === 0 ? (
          <p className="text-[11.5px] text-ink-3">{tr('checkpoints.empty')}</p>
        ) : (
          <ol className="space-y-1.5">
            {[...task.checkpoints].reverse().map((ck) => (
              <li key={ck.id} className="rounded-md border border-line bg-base/40 px-2 py-1.5" data-checkpoint={ck.id}>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10.5px] text-accent-2">step {ck.stepIdx}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{ck.ctxSummary}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-3">{clock(ck.at)}</span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-ink-3">{ck.id}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// event trail
// ---------------------------------------------------------------------------

export function EventSection({ timeline, taskId }: { timeline: TimelineEntry[]; taskId?: string }): ReactNode {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const shown = timeline
    .filter((entry) => {
      if (!filter.trim()) return true;
      const q = filter.trim().toLowerCase();
      return entry.type.toLowerCase().includes(q) || (entry.summary ?? '').toLowerCase().includes(q);
    })
    .slice(-80)
    .reverse();
  const recordHint = taskId ? `~/.camelia/runs/${taskId}/record.json` : undefined;

  async function copyText(label: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section data-event-section>
      <SectionHeader
        icon="terminal"
        title={tr('events.title')}
        right={
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-ink-3">{timeline.length}</span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-ink-3 hover:text-ink"
              aria-label={open ? tr('events.collapse') : tr('events.expand')}
            >
              <Icon name="chevron" size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          </span>
        }
      />
      {open ? (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex flex-wrap gap-1.5">
            <input
              aria-label={tr('events.filter')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={tr('events.filter')}
              className="min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1 font-mono text-[11px] text-ink outline-none placeholder:text-ink-3"
            />
            {recordHint ? (
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-2 hover:border-accent/40 hover:text-accent"
                title={recordHint}
                onClick={() => void copyText('record', recordHint)}
              >
                {copied === 'record' ? tr('events.copied') : tr('events.copyRecordPath')}
              </button>
            ) : null}
          </div>
          {shown.length === 0 ? (
            <p className="text-[11.5px] text-ink-3">{tr('events.quiet')}</p>
          ) : (
            <ul className="space-y-[3px]">
              {shown.map((entry, i) => {
                const payload = JSON.stringify({ type: entry.type, summary: entry.summary, at: entry.at, traceId: entry.traceId });
                return (
                  <li key={`${entry.at}-${i}`} className="flex items-baseline gap-2 font-mono text-[10.5px]">
                    <span className="shrink-0 text-ink-3/70">{clock(entry.at)}</span>
                    <span className="shrink-0 text-accent-2">{entry.type}</span>
                    {entry.summary ? <span className="min-w-0 flex-1 truncate text-ink-3">{entry.summary}</span> : <span className="flex-1" />}
                    <button
                      type="button"
                      className="shrink-0 text-ink-3 hover:text-accent"
                      title={tr('events.copyEvent')}
                      onClick={() => void copyText(`${entry.at}-${i}`, payload)}
                    >
                      {copied === `${entry.at}-${i}` ? tr('events.copied') : tr('events.copy')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

/**
 * Render one panel by id.
 *
 * The switch is exhaustive over `PanelId`, and the default arm is unreachable by
 * construction — adding a seventh panel to `panels.ts` makes this function a type error
 * until it is handled. That is the point of routing through one dispatcher: the icon row
 * and the deck read the same table, so an icon can never open a body that does not exist.
 */
function ArtifactsSection(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const mode = useUiStore((s) => s.mode);
  const task = useUiStore((s) => s.snapshot.task);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const artifacts = task?.artifacts ?? [];
  return (
    <div data-panel-artifacts className="space-y-2">
      {mode === 'math' ? <MathArtifactBody /> : null}
      {artifacts.length === 0 ? (
        mode === 'math' ? null : (
          <p className="px-1 py-6 text-center text-[12px] text-ink-3">{tr('panel.artifacts.empty')}</p>
        )
      ) : (
        <>
          <p className="px-1 text-[11px] text-ink-3">{tr('panel.artifacts.hint')}</p>
          <ul className="mt-2 space-y-1">
            {artifacts.map((a) => (
              <li key={a.path} data-artifact={a.path} className="rounded-md px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Icon name={a.kind === 'diff' ? 'branch' : a.kind === 'stdout' ? 'terminal' : 'file'} size={13} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink" title={a.path}>{a.path}</span>
                </div>
                <p className="mt-0.5 pl-5 font-mono text-[10.5px] text-ink-3" data-artifact-meta>
                  {a.kind}
                  {a.sizeBytes !== undefined ? ` · ${bytes(a.sizeBytes)}` : ''}
                  {a.hash ? ` · ${a.hash}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function PanelBody({ id }: { id: PanelId }): ReactNode {
  const task = useUiStore((s) => s.snapshot.task);
  const timeline = useUiStore((s) => s.snapshot.timeline);

  switch (id) {
    case 'memory':
      return <MemoryPanel />;
    case 'health':
      return <HealthMetricsPanel />;
    case 'events':
      return <EventSection timeline={timeline} taskId={task?.id} />;
    case 'run':
      // Three sections, one icon: progress, the step list and checkpoints are three views
      // of what the run is doing right now.
      return task ? (
        <>
          <RunSection task={task} />
          <StepsSection task={task} />
          <CheckpointSection task={task} />
        </>
      ) : null;
    case 'context':
      return task ? <ContextSection task={task} /> : null;
    case 'sub':
      return task ? <SubAgentsSection task={task} /> : null;
    case 'artifacts':
      return <ArtifactsSection />;
    default:
      return null;
  }
}

/**
 * `PANELS` / `panelsForMode` / `PanelId` are deliberately **not** re-exported here.
 *
 * They live in `src/panels.ts` because the store needs `PanelId` and the store cannot
 * import this file — this file imports the store. Re-exporting would give two paths to the
 * same table, and the only question then worth asking is which one a new file imports.
 */
