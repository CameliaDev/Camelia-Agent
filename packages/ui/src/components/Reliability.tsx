/**
 * Reliability surfaces — chapter 4 of the whitepaper, made visible.
 *
 * Drift, loops, blocked hallucinations and recoveries are useless if the user cannot see
 * them. These three cards are the projection of `reliability.*` / `recovery.*` events and
 * the approval gate: every one of them offers the user a concrete action, because a
 * notice with no action is just noise.
 * @module
 */

import type { ReactNode } from 'react';

import type { ApprovalView, FailureView, NoticeView, CheckpointView } from '@camelia/agent/view';

import { clock, preview } from '../lib/format.js';
import { NOTICE_META, RISK_META, TONE_BG, TONE_TEXT } from '../lib/status.js';
import { Chip, Icon } from './primitives.js';

export function NoticeBanner({ notice }: { notice: NoticeView }): ReactNode {
  const meta = NOTICE_META[notice.kind];
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${TONE_BG[meta.tone]}`}>
      <Icon name={meta.icon} size={15} className="mt-[1px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-semibold">{notice.title}</span>
          <span className="text-[10.5px] opacity-70">{clock(notice.at)}</span>
        </div>
        <p className="mt-0.5 text-[11.5px] leading-5 opacity-90">{notice.detail}</p>
        <p className="mt-1 font-mono text-[10.5px] opacity-80">action: {notice.action}</p>
      </div>
    </div>
  );
}

export function ApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  approval: ApprovalView;
  onApprove: (scope: 'once' | 'session') => void;
  onDeny: () => void;
}): ReactNode {
  const risk = RISK_META[approval.risk];
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
      <div className="flex items-center gap-2">
        <Icon name="shield" size={15} className="text-warn" />
        <span className="text-[12.5px] font-semibold text-warn">Approval required</span>
        <Chip tone={risk.tone}>{risk.label}</Chip>
        <span className="ml-auto text-[10.5px] text-ink-3">{clock(approval.at)}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-ink-2">
        <span className="font-mono text-ink">{approval.name}</span> wants to run with elevated risk.
      </p>
      <pre className="mt-2 overflow-x-auto rounded border border-line bg-base/70 px-2 py-1.5 font-mono text-[11px] text-ink-2">
        {preview(approval.input, 400)}
      </pre>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onApprove('once')}
          className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-base hover:bg-accent-2"
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={() => onApprove('session')}
          className="rounded-md border border-accent/40 px-2.5 py-1 text-[11.5px] font-medium text-accent hover:bg-accent/10"
        >
          Allow for session
        </button>
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-bad/40 hover:text-bad"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

export function FailureCard({
  failure,
  checkpoint,
  onRetry,
  onDegrade,
  onRollback,
}: {
  failure: FailureView;
  checkpoint?: CheckpointView;
  onRetry: () => void;
  onDegrade: () => void;
  onRollback: () => void;
}): ReactNode {
  return (
    <div className="rounded-lg border border-bad/35 bg-bad/10 p-3">
      <div className="flex items-center gap-2">
        <Icon name="alert" size={15} className="text-bad" />
        <span className="text-[12.5px] font-semibold text-bad">
          {failure.recoverable ? 'Failure — recoverable' : 'Failure — exhausted'}
        </span>
        {failure.errorClass ? <Chip tone="bad">{failure.errorClass}</Chip> : null}
        <span className="ml-auto text-[10.5px] text-ink-3">{clock(failure.at)}</span>
      </div>

      <p className="mt-1.5 font-mono text-[11.5px] leading-5 text-ink-2">{failure.reason}</p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className="text-ink-3">attempts</dt>
        <dd className="text-ink-2">{failure.attempts}</dd>
        <dt className="text-ink-3">strategy</dt>
        <dd className="font-mono text-ink-2">{failure.strategy ?? '—'}</dd>
        <dt className="text-ink-3">suggested</dt>
        <dd className="text-ink-2">{failure.suggestion}</dd>
        {checkpoint ? (
          <>
            <dt className="text-ink-3">checkpoint</dt>
            <dd className="font-mono text-ink-2">
              {checkpoint.id} · step {checkpoint.stepIdx} · {checkpoint.ctxSummary}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-base hover:bg-accent-2"
        >
          <Icon name="refresh" size={12} />
          Retry the step
        </button>
        <button
          type="button"
          onClick={onDegrade}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-info/40 hover:text-info"
        >
          <Icon name="layers" size={12} />
          Fall back to a smaller model
        </button>
        <button
          type="button"
          onClick={onRollback}
          disabled={!checkpoint}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-warn/40 hover:text-warn disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="undo" size={12} />
          Roll back
        </button>
      </div>
    </div>
  );
}

export function StepErrorLine({ error }: { error: string }): ReactNode {
  return (
    <p className={`mt-1 font-mono text-[11px] ${TONE_TEXT.bad}`}>{error}</p>
  );
}