import { describe, expect, it } from 'vitest';

import { DEFAULT_FEEDBACK_REPO, feedbackRepo, submitFeedback } from '../src/window/feedback.js';

const payload = {
  type: 'bug' as const,
  title: 'Timeline stuck',
  body: 'Done appeared before any worker ran.',
  repro: 'Open Term and send a goal.',
  appVersion: '0.1.0',
  mode: 'term',
  os: 'test',
};

describe('submitFeedback', () => {
  it('posts a bug to the configured repo with the user token and no labels', async () => {
    let seen: { url?: string; authorization?: string; body?: { title?: string; body?: string; labels?: unknown } } = {};
    const result = await submitFeedback(
      { ...payload, repo: 'acme/camelia-feedback', includeMeta: true },
      {
        token: 'gho_test_token',
        fetchImpl: (async (url, init) => {
          seen = {
            url: String(url),
            authorization: new Headers(init?.headers).get('authorization') ?? undefined,
            body: JSON.parse(String(init?.body)) as { title?: string; body?: string; labels?: unknown },
          };
          return new Response(JSON.stringify({ html_url: 'https://github.com/acme/camelia-feedback/issues/3' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
    );
    expect(result).toEqual({ ok: true, url: 'https://github.com/acme/camelia-feedback/issues/3' });
    expect(seen.url).toBe('https://api.github.com/repos/acme/camelia-feedback/issues');
    expect(seen.authorization).toBe('Bearer gho_test_token');
    expect(seen.body?.title).toBe('[bug] Timeline stuck');
    expect(seen.body?.body).toContain('Done appeared before any worker ran.');
    expect(seen.body?.body).toContain('App: 0.1.0');
    expect(seen.body?.body).toContain('Mode: term');
    expect(seen.body?.labels).toBeUndefined();
  });

  it('omits version and mode when the user opts out', async () => {
    let body = '';
    await submitFeedback(
      { ...payload, includeMeta: false },
      {
        token: 'gho_test_token',
        fetchImpl: (async (_url, init) => {
          body = String(init?.body);
          return new Response(JSON.stringify({ html_url: 'https://github.com/CameliaDev/camelia-feedback/issues/1' }), {
            status: 201,
          });
        }) as typeof fetch,
      },
    );
    expect(body).not.toContain('App: 0.1.0');
    expect(body).not.toContain('Mode: term');
    const issue = JSON.parse(body) as { title: string; body: string };
    expect(issue.title).toContain('Timeline stuck');
    expect(issue.body).toContain('Done appeared before any worker ran.');
    expect(issue.body).not.toContain('## Environment');
  });

  it('does not report success when the repo is missing', async () => {
    const result = await submitFeedback(payload, {
      token: 'gho_test_token',
      fetchImpl: (async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing-repo');
    expect(result.url).toBeUndefined();
  });

  it('refuses to call GitHub without a token', async () => {
    let called = false;
    const result = await submitFeedback(payload, {
      token: '  ',
      fetchImpl: (async () => {
        called = true;
        return new Response('{}', { status: 201 });
      }) as typeof fetch,
    });
    expect(result).toEqual({ ok: false, error: 'need-login' });
    expect(called).toBe(false);
  });

  it('rejects a repo that is not owner/name', () => {
    expect(feedbackRepo('not a repo').ok).toBe(false);
    const empty = feedbackRepo('');
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.repo).toBe(DEFAULT_FEEDBACK_REPO);
  });
});
