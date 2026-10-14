/**
 * Feedback form — bug / idea → GitHub Issues. Prompts GitHub login when needed.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useMode } from '../mode/useMode.js';
import { useUiStore } from '../state/UiProvider.js';
import { openExternalUrl } from '../window/github-auth.js';
import { productVersion } from '../transport/boot.js';
import { DEFAULT_FEEDBACK_REPO, submitFeedback, type FeedbackType } from '../window/feedback.js';

export function FeedbackForm({ onNeedLogin }: { onNeedLogin?: () => void }): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const github = useUiStore((s) => s.localPrefs.githubAccount);
  const feedbackRepo = useUiStore((s) => s.localPrefs.feedbackRepo);
  const includeMeta = useUiStore((s) => s.localPrefs.includeFeedbackMeta);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const { mode } = useMode();
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [repro, setRepro] = useState('');
  const [repo, setRepo] = useState(feedbackRepo);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [issueUrl, setIssueUrl] = useState('');

  async function submit(): Promise<void> {
    if (!github) {
      setNote(tr('feedback.needLogin'));
      return;
    }
    setBusy(true);
    setNote('');
    setIssueUrl('');
    try {
      const result = await submitFeedback({
        type,
        title,
        body,
        repro,
        appVersion: productVersion(),
        mode,
        os: typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : 'unknown',
        includeMeta,
        repo: repo.trim() || undefined,
      });
      if (!result.ok) {
        if (result.error === 'need-login') {
          setNote(tr('feedback.needLogin'));
          onNeedLogin?.();
        } else if (result.error === 'missing-repo') {
          setNote(tr('feedback.missingRepo'));
        } else if (result.error === 'unauthorized') {
          setNote(tr('feedback.unauthorized'));
        } else if (result.error === 'invalid-repo') {
          setNote(tr('feedback.invalidRepo'));
        } else {
          setNote(`${tr('feedback.error')}: ${result.error ?? ''}`);
        }
        return;
      }
      setIssueUrl(result.url ?? '');
      setNote(tr('feedback.success'));
      if (!repo.trim() || /^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
        setLocalPrefs({ feedbackRepo: repo.trim() });
      }
      setTitle('');
      setBody('');
      setRepro('');
    } finally {
      setBusy(false);
    }
  }

  const field = 'mt-1 w-full rounded-md border border-line/80 bg-base px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-ink-3/40';

  return (
    <div className="mx-auto max-w-lg space-y-3" data-feedback-form>
      <div className="flex gap-1" role="group" aria-label={tr('feedback.type')}>
        {(['bug', 'idea'] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-feedback-type={id}
            aria-pressed={type === id}
            className={`rounded-md px-2.5 py-1 text-[12px] ${
              type === id ? 'bg-hover font-medium text-ink' : 'text-ink-3 hover:text-ink'
            }`}
            onClick={() => setType(id)}
          >
            {tr(id === 'bug' ? 'feedback.type.bug' : 'feedback.type.idea')}
          </button>
        ))}
      </div>
      <label className="block text-[11px] font-medium text-ink-2">
        {tr('feedback.title')}
        <input
          className={field}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-feedback-title
        />
      </label>
      <label className="block text-[11px] font-medium text-ink-2">
        {tr('feedback.body')}
        <textarea
          rows={4}
          className={field}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          data-feedback-body
        />
      </label>
      <label className="block text-[11px] text-ink-3">
        {tr('feedback.repro')}
        <textarea
          rows={2}
          className={field}
          value={repro}
          onChange={(e) => setRepro(e.target.value)}
          data-feedback-repro
        />
      </label>
      <label className="block text-[11px] text-ink-3">
        {tr('feedback.repoInput')}
        <input
          className={field}
          value={repo}
          placeholder={DEFAULT_FEEDBACK_REPO}
          data-feedback-repo
          onChange={(e) => {
            const next = e.target.value;
            setRepo(next);
            const trimmed = next.trim();
            if (!trimmed || /^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
              setLocalPrefs({ feedbackRepo: trimmed });
            }
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={includeMeta}
          data-feedback-meta
          onChange={(e) => setLocalPrefs({ includeFeedbackMeta: e.target.checked })}
        />
        {tr('feedback.includeMeta')}
      </label>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={busy || !title.trim() || !body.trim()}
          data-feedback-submit
          className="rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            void submit();
          }}
        >
          {tr('feedback.submit')}
        </button>
        <p className="min-w-0 truncate text-[11px] text-ink-3">
          {tr('feedback.repo')} <span className="font-mono">{repo.trim() || DEFAULT_FEEDBACK_REPO}</span>
        </p>
      </div>
      {note ? <p className="text-[11.5px] text-ink-2" data-feedback-note>{note}</p> : null}
      {!github ? (
        <button
          type="button"
          className="text-[12px] text-accent underline"
          data-feedback-login
          onClick={() => onNeedLogin?.()}
        >
          {tr('feedback.signIn')}
        </button>
      ) : null}
      {issueUrl ? (
        <button
          type="button"
          className="text-[11.5px] text-accent underline"
          onClick={() => {
            void openExternalUrl(issueUrl);
          }}
        >
          {issueUrl}
        </button>
      ) : null}
    </div>
  );
}
