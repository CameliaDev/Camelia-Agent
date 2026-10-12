import fs from 'node:fs';

// --- Conversation.tsx ---
{
  let s = fs.readFileSync('packages/ui/src/components/Conversation.tsx', 'utf8');
  if (!s.includes('canIntervene')) {
    if (!s.includes("from '../i18n/strings.js';")) throw new Error('import anchor');
    s = s.replace(
      "import { t } from '../i18n/strings.js';",
      "import { t } from '../i18n/strings.js';\nimport { canIntervene, interveneUnavailableReason } from '../window/capabilities.js';",
    );
  }

  // EmptyState checklist
  const emptyOld = `    return (
      <EmptyState
        icon="camellia"
        title={tr('welcome.title')}
        hint={tr('welcome.body')}
      />
    );`;
  const emptyNew = `    return (
      <EmptyState
        icon="camellia"
        title={tr('welcome.title')}
        hint={tr('welcome.body')}
        action={
          <ul className="mt-1 space-y-1 text-left text-[11.5px] text-ink-3" data-welcome-checklist>
            <li>· {tr('welcome.check.workspace')}</li>
            <li>· {tr('welcome.check.doctor')}</li>
            <li>· {tr('welcome.check.model')}</li>
          </ul>
        }
      />
    );`;
  if (s.includes('data-welcome-checklist')) console.log('empty ok');
  else if (!s.includes(emptyOld)) throw new Error('empty needle missing');
  else s = s.replace(emptyOld, emptyNew);

  // Wire FailureCard capabilities + command error banner
  if (!s.includes('lastCommandError')) {
    s = s.replace(
      `  const { snapshot, status, transportError, dispatch } = useUiState();
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);`,
      `  const { snapshot, status, transportError, lastCommandError, dispatch } = useUiState();
  const clearCommandError = useUiStore((s) => s.clearCommandError);
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const rollbackOk = canIntervene('rollback_step');
  const degradeOk = canIntervene('select_provider');`,
    );
  }

  // Insert command error banner before notices
  if (!s.includes('data-command-error')) {
    const notices = `{task.notices.length ? (`;
    const banner = `{lastCommandError ? (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn" data-command-error>
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 font-mono text-[11.5px]">
                {lastCommandError.type}: {lastCommandError.error}
              </span>
              <button type="button" className="shrink-0 text-[11px] underline" onClick={() => clearCommandError()}>
                {tr('commandError.dismiss')}
              </button>
            </div>
          </div>
        ) : null}

        {task.notices.length ? (`;
    if (!s.includes(notices)) throw new Error('notices needle missing');
    s = s.replace(notices, banner);
  }

  // FailureCard props
  if (!s.includes('canRollback={rollbackOk}')) {
    const oldFail = `              <FailureCard
                key={\`\${failure.at}-\${i}\`}
                failure={failure}
                checkpoint={checkpoint}
                onRetry={() =>
                  dispatch(
                    makeCommand('intervene_goal', {
                      taskId: task.id,
                      instruction: 'Retry the failed step and report the new evidence.',
                    }),
                  )
                }
                onDegrade={() => dispatch(makeCommand('select_provider', { providerId: 'ollama', model: 'qwen2.5-coder:7b' }))}
                onRollback={() => checkpoint && rollback(checkpoint.stepIdx, checkpoint.id)}
              />`;
    const newFail = `              <FailureCard
                key={\`\${failure.at}-\${i}\`}
                failure={failure}
                checkpoint={checkpoint}
                canRollback={rollbackOk}
                canDegrade={degradeOk}
                rollbackUnavailableReason={interveneUnavailableReason('rollback_step') || tr('intervene.rollbackUnavailable')}
                degradeUnavailableReason={interveneUnavailableReason('select_provider') || tr('intervene.degradeUnavailable')}
                labels={{
                  recoverable: tr('failure.recoverable'),
                  exhausted: tr('failure.exhausted'),
                  attempts: tr('failure.attempts'),
                  strategy: tr('failure.strategy'),
                  suggested: tr('failure.suggested'),
                  checkpoint: tr('failure.checkpoint'),
                  retry: tr('failure.retry'),
                  degrade: tr('failure.degrade'),
                  rollback: tr('failure.rollback'),
                }}
                onRetry={() =>
                  dispatch(
                    makeCommand('intervene_goal', {
                      taskId: task.id,
                      instruction: 'Retry the failed step and report the new evidence.',
                    }),
                  )
                }
                onDegrade={() => {
                  if (!degradeOk) return;
                  dispatch(makeCommand('select_provider', { providerId: 'ollama', model: 'qwen2.5-coder:7b' }));
                }}
                onRollback={() => {
                  if (!rollbackOk || !checkpoint) return;
                  rollback(checkpoint.stepIdx, checkpoint.id);
                }}
              />`;
    if (!s.includes('onDegrade={() => dispatch(makeCommand(\'select_provider\'')) {
      // try alternate
      if (!s.includes("onDegrade={() => dispatch(makeCommand('select_provider'")) throw new Error('failure block missing');
    }
    if (!s.includes(oldFail)) {
      // write debug
      const idx = s.indexOf('<FailureCard');
      console.log('FailureCard at', idx, s.slice(idx, idx + 500));
      throw new Error('failure old block missing');
    }
    s = s.replace(oldFail, newFail);
  }

  // Guard TaskRecord rollback similarly - StepCard may call onRollback
  // Update rollback helper to no-op when unavailable
  if (!s.includes('if (!canIntervene')) {
    s = s.replace(
      `  const rollback = (stepIdx: number, checkpointId: Id): void => {
    void stepIdx;
    dispatch(makeCommand('rollback_step', { taskId: task?.id ?? '', checkpointId }));
  };`,
      `  const rollback = (stepIdx: number, checkpointId: Id): void => {
    void stepIdx;
    if (!canIntervene('rollback_step')) return;
    dispatch(makeCommand('rollback_step', { taskId: task?.id ?? '', checkpointId }));
  };`,
    );
  }

  fs.writeFileSync('packages/ui/src/components/Conversation.tsx', s);
  console.log('Conversation patched');
}
