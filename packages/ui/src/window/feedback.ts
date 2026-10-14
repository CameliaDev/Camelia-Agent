/**
 * In-app feedback → GitHub Issues on a dedicated repo.
 * Uses the user's stored GitHub PAT (same as account login). Never ships secrets by default.
 * @module
 */

import { readGithubToken } from './github-auth.js';

export const DEFAULT_FEEDBACK_REPO = 'CameliaDev/camelia-feedback';

export type FeedbackType = 'bug' | 'idea';

export interface FeedbackPayload {
  type: FeedbackType;
  title: string;
  body: string;
  repro?: string;
  appVersion: string;
  mode: string;
  os: string;
  /** When false, version / mode / OS are left out of the issue body. Default true. */
  includeMeta?: boolean;
  includeLogs?: boolean;
  logSnippet?: string;
  /** Override default repo (owner/name). */
  repo?: string;
}

export interface FeedbackResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** `owner/name`. Empty input uses the default public feedback repo. */
export function feedbackRepo(raw?: string): { ok: true; repo: string } | { ok: false; error: 'invalid-repo' } {
  const value = (raw ?? '').trim() || DEFAULT_FEEDBACK_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(value)) return { ok: false, error: 'invalid-repo' };
  return { ok: true, repo: value };
}

export async function submitFeedback(
  payload: FeedbackPayload,
  options?: { token?: string; fetchImpl?: typeof fetch },
): Promise<FeedbackResult> {
  const token = (options?.token ?? readGithubToken()).trim();
  if (!token) return { ok: false, error: 'need-login' };
  const title = payload.title.trim();
  const bodyCore = payload.body.trim();
  if (!title || !bodyCore) return { ok: false, error: 'empty' };

  const parts = [
    `## ${payload.type === 'bug' ? 'Bug' : 'Idea'}`,
    '',
    bodyCore,
  ];
  if (payload.repro?.trim()) {
    parts.push('', '## Repro', '', payload.repro.trim());
  }
  if (payload.includeMeta !== false) {
    parts.push(
      '',
      '## Environment',
      '',
      `- App: ${payload.appVersion}`,
      `- Mode: ${payload.mode}`,
      `- OS: ${payload.os}`,
    );
  }
  if (payload.includeLogs && payload.logSnippet?.trim()) {
    parts.push('', '## Logs (user opted in)', '', '```', payload.logSnippet.trim().slice(0, 8000), '```');
  }
  parts.push('', '_Submitted from Camelia in-app feedback. No API keys included._');

  const repo = feedbackRepo(payload.repo);
  if (!repo.ok) return { ok: false, error: repo.error };
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo.repo}/issues`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      // Labels are omitted on purpose: a brand-new empty repo has none, and
      // GitHub rejects the whole issue with 422 when a label is missing.
      body: JSON.stringify({
        title: `[${payload.type}] ${title}`.slice(0, 200),
        body: parts.join('\n'),
      }),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'unauthorized' };
    if (res.status === 404) return { ok: false, error: 'missing-repo' };
    if (!res.ok) return { ok: false, error: `http-${res.status}` };
    const json = (await res.json()) as { html_url?: string };
    if (!json.html_url) return { ok: false, error: 'malformed' };
    return { ok: true, url: json.html_url };
  } catch {
    return { ok: false, error: 'offline' };
  }
}
