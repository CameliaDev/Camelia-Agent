/**
 * Feedback form — bug / idea → GitHub Issues. Prompts GitHub login when needed.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useMode } from '../mode/useMode.js';
import { useUiStore } from '../state/UiProvider.js';
import { openExternalUrl } from '../window/github-auth.js';
import { DEFAULT_FEEDBACK_REPO, submitFeedback, type FeedbackType } from '../window/feedback.js';

export function FeedbackForm({ onNeedLogin }: { onNeedLogin?: () => void }): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const github = useUiStore((s) => s.localPrefs.githubAccount);
  const { mode } = useMode();
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [repro, setRepro] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [issueUrl, setIssueUrl] = useState('');

  async function submit(): Promise<void> {
    if (!github) {
      setNote(tr('feedback.needLogin'));
      onNeedLogin?.();
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
        appVersion: '0.1.0',
        mode,
        os: typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : 'unknown',
      });
      if (!result.ok) {
        if (result.error === 'need-login') {
          setNote(tr('feedback.needLogin'));
          onNeedLogin?.();
        } else {
          setNote(`${tr('feedback.error')}: ${result.error ?? ''}`);
        }
        return;
      }
      setIssueUrl(result.url ?? '');
      setNote(tr('feedback.success'));
      setTitle('');
      setBody('');
      setRepro('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-feedback-form>
      <p className="text-[11.5px] text-ink-3">
        {tr('feedback.repo')}: <span className="font-mono">{DEFAULT_FEEDBACK_REPO}</span>
      </p>
      <div className="flex gap-1.5">
        {(['bug', 'idea'] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-feedback-type={id}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
              type === id ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-ink-2'
            }`}
            onClick={() => setType(id)}
          >
            {tr(id === 'bug' ? 'feedback.type.bug' : 'feedback.type.idea')}
          </button>
        ))}
      </div>
      <label className="block text-[12px] text-ink-2">
        {tr('feedback.title')}
        <input
          className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-[12px] text-ink"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-feedback-title
        />
      </label>
      <label className="block text-[12px] text-ink-2">
        {tr('feedback.body')}
        <textarea
          rows={4}
          className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-[12px] text-ink"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          data-feedback-body
        />
      </label>
      <label className="block text-[12px] text-ink-2">
        {tr('feedback.repro')}
        <textarea
          rows={2}
          className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-[12px] text-ink"
          value={repro}
          onChange={(e) => setRepro(e.target.value)}
          data-feedback-repro
        />
      </label>
      <button
        type="button"
        disabled={busy || !title.trim() || !body.trim()}
        data-feedback-submit
        className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px] text-accent hover:bg-accent/15 disabled:opacity-40"
        onClick={() => {
          void submit();
        }}
      >
        {tr('feedback.submit')}
      </button>
      {note ? <p className="text-[11.5px] text-ink-2" data-feedback-note>{note}</p> : null}
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
