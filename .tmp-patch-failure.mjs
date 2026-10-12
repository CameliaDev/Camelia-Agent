import fs from 'node:fs';

// --- Reliability.tsx FailureCard ---
{
  let s = fs.readFileSync('packages/ui/src/components/Reliability.tsx', 'utf8');
  if (!s.includes('canRollback')) {
    s = s.replace(
      `export function FailureCard({
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
}`,
      `export function FailureCard({
  failure,
  checkpoint,
  onRetry,
  onDegrade,
  onRollback,
  canRollback = true,
  canDegrade = true,
  rollbackUnavailableReason,
  degradeUnavailableReason,
  labels,
}: {
  failure: FailureView;
  checkpoint?: CheckpointView;
  onRetry: () => void;
  onDegrade: () => void;
  onRollback: () => void;
  canRollback?: boolean;
  canDegrade?: boolean;
  rollbackUnavailableReason?: string;
  degradeUnavailableReason?: string;
  labels?: {
    recoverable: string;
    exhausted: string;
    attempts: string;
    strategy: string;
    suggested: string;
    checkpoint: string;
    retry: string;
    degrade: string;
    rollback: string;
  };
}): ReactNode {
  const L = {
    recoverable: labels?.recoverable ?? 'Failure — recoverable',
    exhausted: labels?.exhausted ?? 'Failure — exhausted',
    attempts: labels?.attempts ?? 'attempts',
    strategy: labels?.strategy ?? 'strategy',
    suggested: labels?.suggested ?? 'suggested',
    checkpoint: labels?.checkpoint ?? 'checkpoint',
    retry: labels?.retry ?? 'Retry the step',
    degrade: labels?.degrade ?? 'Fall back to a smaller model',
    rollback: labels?.rollback ?? 'Roll back',
  };
  const rollbackEnabled = Boolean(checkpoint) && canRollback;
  const degradeEnabled = canDegrade;
  return (
    <div className="rounded-lg border border-bad/35 bg-bad/10 p-3" data-failure-card>
      <div className="flex items-center gap-2">
        <Icon name="alert" size={15} className="text-bad" />
        <span className="text-[12.5px] font-semibold text-bad">
          {failure.recoverable ? L.recoverable : L.exhausted}
        </span>
        {failure.errorClass ? <Chip tone="bad">{failure.errorClass}</Chip> : null}
        <span className="ml-auto text-[10.5px] text-ink-3">{clock(failure.at)}</span>
      </div>

      <p className="mt-1.5 font-mono text-[11.5px] leading-5 text-ink-2">{failure.reason}</p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className="text-ink-3">{L.attempts}</dt>
        <dd className="text-ink-2">{failure.attempts}</dd>
        <dt className="text-ink-3">{L.strategy}</dt>
        <dd className="font-mono text-ink-2">{failure.strategy ?? '—'}</dd>
        <dt className="text-ink-3">{L.suggested}</dt>
        <dd className="text-ink-2">{failure.suggestion}</dd>
        {checkpoint ? (
          <>
            <dt className="text-ink-3">{L.checkpoint}</dt>
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
          {L.retry}
        </button>
        <button
          type="button"
          onClick={onDegrade}
          disabled={!degradeEnabled}
          title={!degradeEnabled ? degradeUnavailableReason : undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-info/40 hover:text-info disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="layers" size={12} />
          {L.degrade}
        </button>
        <button
          type="button"
          onClick={onRollback}
          disabled={!rollbackEnabled}
          title={!rollbackEnabled ? (rollbackUnavailableReason || (!checkpoint ? 'No checkpoint' : undefined)) : undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-warn/40 hover:text-warn disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="undo" size={12} />
          {L.rollback}
        </button>
      </div>
      {!degradeEnabled && degradeUnavailableReason ? (
        <p className="mt-2 text-[11px] text-ink-3" data-intervene-unavailable="degrade">{degradeUnavailableReason}</p>
      ) : null}
      {!canRollback && rollbackUnavailableReason ? (
        <p className="mt-1 text-[11px] text-ink-3" data-intervene-unavailable="rollback">{rollbackUnavailableReason}</p>
      ) : null}
    </div>
  );
}`,
    );
    fs.writeFileSync('packages/ui/src/components/Reliability.tsx', s);
    console.log('Reliability patched');
  } else console.log('Reliability ok');
}
