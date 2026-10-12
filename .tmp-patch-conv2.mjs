import fs from 'node:fs';

function edit(path, fn) {
  const raw = fs.readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  s = fn(s);
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}

edit('packages/ui/src/components/Conversation.tsx', (s) => {
  if (!s.includes("from '../window/capabilities.js'")) {
    s = s.replace(
      "import { t } from '../i18n/strings.js';",
      "import { t } from '../i18n/strings.js';\nimport { canIntervene, interveneUnavailableReason } from '../window/capabilities.js';",
    );
  }

  if (!s.includes('data-welcome-checklist')) {
    const emptyOld = `<EmptyState
        icon="camellia"
        title={tr('welcome.title')}
        hint={tr('welcome.body')}
      />`;
    const emptyNew = `<EmptyState
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
      />`;
    if (!s.includes(emptyOld)) throw new Error('empty needle');
    s = s.replace(emptyOld, emptyNew);
  }

  if (!s.includes('lastCommandError')) {
    const old = `  const { snapshot, status, transportError, dispatch } = useUiState();
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);`;
    const neu = `  const { snapshot, status, transportError, lastCommandError, dispatch } = useUiState();
  const clearCommandError = useUiStore((s) => s.clearCommandError);
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const rollbackOk = canIntervene('rollback_step');
  const degradeOk = canIntervene('select_provider');`;
    if (!s.includes(old)) throw new Error('useUiState needle');
    s = s.replace(old, neu);
  }

  if (!s.includes("if (!canIntervene('rollback_step')) return;")) {
    const old = `  const rollback = (stepIdx: number, checkpointId: Id): void => {
    void stepIdx;
    dispatch(makeCommand('rollback_step', { taskId: task?.id ?? '', checkpointId }));
  };`;
    const neu = `  const rollback = (stepIdx: number, checkpointId: Id): void => {
    void stepIdx;
    if (!canIntervene('rollback_step')) return;
    dispatch(makeCommand('rollback_step', { taskId: task?.id ?? '', checkpointId }));
  };`;
    if (!s.includes(old)) throw new Error('rollback needle');
    s = s.replace(old, neu);
  }

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
    if (!s.includes(notices)) throw new Error('notices needle');
    s = s.replace(notices, banner);
  }

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
    if (!s.includes(oldFail)) throw new Error('failure needle');
    s = s.replace(oldFail, newFail);
  }

  return s;
});
console.log('Conversation ok');
