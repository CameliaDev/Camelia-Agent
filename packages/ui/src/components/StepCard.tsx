/**
 * Step card — one step of the plan, with everything the user needs to judge it.
 *
 * The whitepaper requires the step list to be inspectable *in place*: what the step was
 * asked to do, what the agent narrated while doing it, which tools ran, whether the
 * acceptance points passed, and a rollback affordance once it is done. That is why this
 * card owns narration + tool calls + verdicts rather than splitting them across panels.
 * @module
 */

import type { ReactNode } from 'react';

import type { NarrationView, StepView, ToolCallView } from '@camelia/agent/view';

import { CollapsibleBlock } from './CollapsibleBlock.js';
import { isNoisyAssistantText } from '../lib/noisy-text.js';

import { clock, ms } from '../lib/format.js';
import { STEP_META, TONE_TEXT } from '../lib/status.js';
import { useUiStore } from '../state/UiProvider.js';
import { localizeAcceptanceKind, localizePlanText } from '../i18n/plan-copy.js';
import { t } from '../i18n/strings.js';
import { ToolCard } from './ToolCard.js';
import { Avatar, Chip, Icon } from './primitives.js';

function StepGlyph({ status }: { status: StepView['status'] }): ReactNode {
  if (status === 'running') {
    return (
      <span className="relative grid h-5 w-5 place-items-center">
        <span className="camelia-pulse absolute h-4 w-4 rounded-full bg-accent/30" />
        <span className="h-2 w-2 rounded-full bg-accent" />
      </span>
    );
  }
  const icon =
    status === 'done' ? 'check' : status === 'failed' ? 'x' : status === 'skipped' ? 'dash' : status === 'verifying' ? 'eye' : 'dot';
  return (
    <span
      className={`grid h-5 w-5 place-items-center rounded-full border ${
        status === 'done'
          ? 'border-ok/40 bg-ok/15 text-ok'
          : status === 'failed'
            ? 'border-bad/40 bg-bad/15 text-bad'
            : status === 'verifying'
              ? 'border-info/40 bg-info/15 text-info'
              : 'border-line bg-hover text-ink-3'
      }`}
    >
      <Icon name={icon} size={12} />
    </span>
  );
}

/**
 * Which tool cards start expanded.
 *
 * A card opens when it needs a decision — a failed or denied call, or one still waiting on
 * approval — or when it is a file edit inside the step the user is currently watching,
 * because that is where a diff is worth reading. Everything else stays collapsed so a long
 * run reads as a list of steps rather than a wall of JSON.
 */
function opensByDefault(call: ToolCallView, active: boolean): boolean {
  if (call.status === 'error' || call.status === 'denied' || call.status === 'awaiting-approval') return true;
  return active && (call.name === 'fs.edit' || call.name === 'fs.write');
}

export function StepCard({
  step,
  narration,
  toolCalls,
  onRollback,
  defaultOpenTools = false,
}: {
  step: StepView;
  narration: NarrationView[];
  toolCalls: ToolCallView[];
  onRollback?: (step: StepView) => void;
  /** Force every card open regardless of status — used by tests that inspect raw output. */
  defaultOpenTools?: boolean;
}): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const statusLabel: Record<string, string> = {
    pending: tr('step.status.pending'),
    running: tr('step.status.running'),
    verifying: tr('step.status.verifying'),
    done: tr('step.status.done'),
    failed: tr('step.status.failed'),
    skipped: tr('step.status.skipped'),
  };
  const meta = STEP_META[step.status];
  const duration = step.startedAt !== undefined && step.endedAt !== undefined ? step.endedAt - step.startedAt : undefined;
  const isActive = step.status === 'running' || step.status === 'verifying';

  return (
    <div className="flex gap-3">
      <div className="flex w-5 shrink-0 flex-col items-center pt-1">
        <StepGlyph status={step.status} />
        <span className="mt-1 w-px flex-1 bg-line" />
      </div>

      <div
        data-step-card
        className={`mb-3 min-w-0 flex-1 rounded-lg border p-3 ${
          isActive ? 'border-accent/35 bg-elevated/80' : 'border-line bg-elevated/50'
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span data-meta className="font-mono text-[10.5px] text-ink-3">{tr('step.stepLabel')} {step.idx + 1}</span>
              <span data-step-status={step.status} className={`text-[10.5px] font-medium ${TONE_TEXT[meta.tone]}`}>{statusLabel[step.status] ?? meta.label}</span>
              {step.weight > 1 ? <span className="text-[10.5px] text-ink-3">{tr('step.weight')} {step.weight}</span> : null}
            </div>
            <h3 className="mt-0.5 text-[13px] font-semibold leading-5 text-ink">{localizePlanText(lang, step.title)}</h3>
            <p data-step-goal className="mt-0.5 text-[11.5px] leading-5 text-ink-2">{localizePlanText(lang, step.goal)}</p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="font-mono text-[10.5px] text-ink-3">{duration !== undefined ? ms(duration) : isActive ? tr('step.status.running') : '—'}</span>
            {step.verdict ? (
              <Chip tone={step.verdict.status === 'pass' ? 'ok' : step.verdict.status === 'fail' ? 'bad' : 'muted'}>
                {tr('step.verify')}: {step.verdict.status === 'pass' ? tr('step.pass') : step.verdict.status === 'fail' ? tr('step.fail') : tr('step.unknown')}
              </Chip>
            ) : null}
            {onRollback && step.status === 'done' ? (
              <button
                type="button"
                onClick={() => onRollback(step)}
                title={`Roll back to the checkpoint after step ${step.idx + 1}`}
                className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-[1px] text-[10px] text-ink-3 hover:border-warn/40 hover:text-warn"
              >
                <Icon name="undo" size={10} />
                {tr('step.rollback')}
              </button>
            ) : null}
          </div>
        </div>

        {narration.length ? (
          <div className="mt-2 flex items-start gap-2" data-message="agent">
            <Avatar kind="agent" size={24} title={tr('avatar.agent')} />
            <div className="min-w-0 flex-1 space-y-1.5 border-l-2 border-accent/30 pl-2.5">
            {narration.map((n) =>
              isNoisyAssistantText(n.text) ? (
                <CollapsibleBlock
                  key={n.id}
                  summary={tr('events.collapse')}
                  defaultOpen={false}
                  preferOpen={false}
                  data-collapsible="narration"
                >
                  <p className="text-[12px] leading-[1.7] text-ink-2">
                    {n.text}
                    {n.streaming ? (
                      <span className="camelia-pulse ml-0.5 inline-block h-3 w-1.5 translate-y-[1px] bg-accent align-middle" />
                    ) : null}
                  </p>
                </CollapsibleBlock>
              ) : (
                <p key={n.id} className="text-[12px] leading-[1.7] text-ink-2">
                  {n.text}
                  {n.streaming ? (
                    <span className="camelia-pulse ml-0.5 inline-block h-3 w-1.5 translate-y-[1px] bg-accent align-middle" />
                  ) : null}
                </p>
              ),
            )}
            </div>
          </div>
        ) : null}

        {toolCalls.length ? (
          <div className="mt-2.5 space-y-1.5">
            {toolCalls.map((call) => (
              <ToolCard key={call.id} call={call} defaultOpen={defaultOpenTools || opensByDefault(call, isActive)} />
            ))}
          </div>
        ) : null}

        {step.acceptance.length ? (
          <div data-acceptance className="mt-2.5 rounded-md border border-line/70 bg-base/40 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              <Icon name="check" size={11} />
              {tr('step.acceptance')} · {step.acceptance.length}
            </div>
            <ul className="mt-1 space-y-0.5">
              {step.acceptance.map((point) => (
                <li key={point.description} className="flex items-start gap-1.5 text-[11.5px] text-ink-2">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                  <span className="min-w-0 flex-1">{localizePlanText(lang, point.description)}</span>
                  <span data-meta className="shrink-0 font-mono text-[10px] text-ink-3">{localizeAcceptanceKind(lang, point.kind)}</span>
                </li>
              ))}
            </ul>
            {step.verdict ? (
              <p className={`mt-1.5 text-[11px] ${step.verdict.status === 'pass' ? 'text-ok' : step.verdict.status === 'fail' ? 'text-bad' : 'text-ink-3'}`}>
                {step.verdict.reason
                  .replace(/^PASS\b/, tr('step.pass'))
                  .replace(/^FAIL\b/, tr('step.fail'))
                  .replace(/· verified/, `· ${tr('step.status.verifying')}`)} · {clock(step.endedAt ?? step.startedAt ?? 0)}
              </p>
            ) : null}
          </div>
        ) : null}

        {step.error ? (
          <p className="mt-2 rounded border border-bad/30 bg-bad/10 px-2 py-1.5 font-mono text-[11px] text-bad">{step.error}</p>
        ) : null}
      </div>
    </div>
  );
}