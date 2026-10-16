/**
 * Site-aware query rewriting, ranking, and reliability gates for web_search.
 * @module
 */
import { describe, expect, it, afterEach } from 'vitest';

import {
  buildSearchQueries,
  detectDomainHints,
  hostRankScore,
  inferSitesFromQuery,
  resultsAreRelevant,
  SITE_HOSTS,
  setWebSearchOverrideForTests,
  setFetchUrlOverrideForTests,
  webSearchTool,
  fetchUrlTool,
} from '../src/tools/builtin/web-search-tools.js';
import { WorkspaceJournal } from '../src/checkpoint/WorkspaceJournal.js';
import type { ToolContext } from '../src/tools/types.js';
import { makeHarness, type Harness } from './helpers/context.js';

function toolContext(
  h: Harness,
  journal = new WorkspaceJournal('/backups', 'task-1', h.fs, h.logger),
): ToolContext {
  return {
    workspace: h.ctx.workspace,
    fs: h.ctx.ports.fs,
    shell: h.ctx.ports.shell,
    search: h.ctx.ports.search,
    logger: h.ctx.infra.logger,
    clock: h.ctx.ports.clock,
    journal,
    signal: h.ctx.signal,
  };
}

describe('inferSitesFromQuery', () => {
  it('detects Chinese and English site hints', () => {
    expect(inferSitesFromQuery('知乎上怎么看这个问题')).toContain('zhihu');
    expect(inferSitesFromQuery('B站教程 ffmpeg')).toContain('bilibili');
    expect(inferSitesFromQuery('douyin 热搜')).toContain('douyin');
    expect(inferSitesFromQuery('github actions cache')).toContain('github');
    expect(inferSitesFromQuery('这个论坛里有人讨论过吗')).toContain('forum');
  });

  it('detects 数模 / CUMCM as mcm', () => {
    expect(inferSitesFromQuery('2025 数模 B 题 碳化硅')).toContain('mcm');
    expect(inferSitesFromQuery('CUMCM 2026 Problem B')).toContain('mcm');
  });
});

describe('detectDomainHints', () => {
  it('parses year, letter, and SiC for CUMCM queries', () => {
    const h = detectDomainHints('查「2025 数模 B 题 碳化硅」');
    expect(h.cumcm).toBe(true);
    expect(h.sic).toBe(true);
    expect(h.year).toBe(2025);
    expect(h.problemLetter).toBe('B');
  });
});

describe('buildSearchQueries', () => {
  it('returns plain query when no sites', () => {
    expect(buildSearchQueries('rust async', [])).toEqual(['rust async']);
  });

  it('adds site: filters for zhihu and github', () => {
    const qs = buildSearchQueries('Rust 异步 知乎', ['zhihu']);
    expect(qs[0]).toBe('Rust 异步 知乎');
    expect(qs.some((q) => q.includes('site:zhihu.com'))).toBe(true);
  });

  it('maps forum shortcut to known hosts', () => {
    expect(SITE_HOSTS.forum?.length ?? 0).toBeGreaterThan(1);
    const qs = buildSearchQueries('nas 推荐', ['forum']);
    expect(qs.some((q) => q.includes('site:'))).toBe(true);
  });

  it('for SiC/2025 B 数模 prefers site:mcm.edu.cn queries', () => {
    const qs = buildSearchQueries('2025 数模 B 题 碳化硅', []);
    expect(qs.some((q) => q.includes('site:mcm.edu.cn'))).toBe(true);
    expect(qs.some((q) => /碳化硅|Drude|Sellmeier/i.test(q))).toBe(true);
  });
});

describe('hostRankScore', () => {
  it('ranks mcm.edu.cn and github above random hosts', () => {
    expect(hostRankScore('https://www.mcm.edu.cn/html_cn/node/abc.html')).toBeGreaterThan(
      hostRankScore('https://random-blog.example/post'),
    );
    expect(hostRankScore('https://github.com/foo/bar')).toBeGreaterThan(
      hostRankScore('https://spam.example/x'),
    );
  });
});

describe('resultsAreRelevant', () => {
  it('accepts mcm.edu.cn for CUMCM queries', () => {
    expect(
      resultsAreRelevant('2025 数模 B 题', [
        {
          title: '2025高教社杯',
          url: 'https://www.mcm.edu.cn/html_cn/node/03c91a.html',
          snippet: '',
          source: 'test',
        },
      ]),
    ).toBe(true);
  });

  it('rejects junk unrelated to the query', () => {
    expect(
      resultsAreRelevant('2025 数模 B 题 碳化硅', [
        {
          title: 'Best sneakers on sale',
          url: 'https://shop.example/shoes',
          snippet: 'buy now',
          source: 'test',
        },
      ]),
    ).toBe(false);
  });
});

describe('web_search reliability gate', () => {
  afterEach(() => {
    setWebSearchOverrideForTests(undefined);
    setFetchUrlOverrideForTests(undefined);
  });

  it('returns no_reliable_sources on empty hits — does not invent a problem title', async () => {
    setWebSearchOverrideForTests(async () => ({
      query: 'missing contest',
      provider: 'test',
      durationMs: 1,
      results: [],
    }));
    const h = makeHarness();
    const result = (await webSearchTool.run({ query: '2026 数模 B题' }, toolContext(h))) as {
      status: string;
      message: string;
      instruction: string;
      results: unknown[];
    };
    expect(result.status).toBe('no_reliable_sources');
    expect(result.message).toBe('未找到可靠来源');
    expect(result.instruction).toMatch(/Do NOT invent/i);
    expect(result.results).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/充换电|基站选址|Drude/);
  });

  it('returns no_reliable_sources when hits are irrelevant junk', async () => {
    setWebSearchOverrideForTests(async () => ({
      query: 'q',
      provider: 'test',
      durationMs: 1,
      results: [
        { title: 'Cheap flights', url: 'https://ads.example/flights', snippet: 'book now', source: 'test' },
      ],
    }));
    const h = makeHarness();
    const result = (await webSearchTool.run({ query: '2025 数模 B 题 碳化硅' }, toolContext(h))) as {
      status: string;
      reason: string;
    };
    expect(result.status).toBe('no_reliable_sources');
    expect(result.reason).toBe('irrelevant_results');
  });

  it('keeps mcm.edu.cn hits for SiC/2025 B and ranks them', async () => {
    setWebSearchOverrideForTests(async (query) => {
      if (query.includes('site:mcm.edu.cn') || /数模|碳化硅/.test(query)) {
        return {
          query,
          provider: 'test',
          durationMs: 1,
          results: [
            {
              title: '基于 Drude-Sellmeier 模型的碳化硅外延层厚度的反演算法',
              url: 'https://www.mcm.edu.cn/html_cn/node/03c91a444e62eee81a3740fa97a461a6.html',
              snippet: '2025 CUMCM Problem B — SiC epitaxial thickness',
              source: 'test',
            },
            {
              title: 'unrelated blog',
              url: 'https://random.example/post',
              snippet: 'hello',
              source: 'test',
            },
          ],
        };
      }
      return { query, provider: 'test', durationMs: 1, results: [] };
    });
    setFetchUrlOverrideForTests(async () => 'official page body '.repeat(20));
    const h = makeHarness();
    const result = (await webSearchTool.run({ query: '2025 数模 B 题 碳化硅' }, toolContext(h))) as {
      status: string;
      results: { url: string; hostRank: number }[];
      queries: string[];
    };
    expect(result.status).toBe('ok');
    expect(result.queries.some((q) => q.includes('site:mcm.edu.cn'))).toBe(true);
    expect(result.results[0]?.url).toMatch(/mcm\.edu\.cn/);
    expect(result.results[0]?.hostRank).toBeGreaterThan(0);
  });
});

describe('fetch_url tool', () => {
  afterEach(() => setFetchUrlOverrideForTests(undefined));

  it('returns stripped text for an http URL', async () => {
    setFetchUrlOverrideForTests(async () => '<html><body><h1>Hello</h1><p>World</p></body></html>');
    const h = makeHarness();
    const result = (await fetchUrlTool.run({ url: 'https://www.mcm.edu.cn/x' }, toolContext(h))) as {
      text: string;
      chars: number;
    };
    expect(result.text).toMatch(/Hello/);
    expect(result.text).toMatch(/World/);
    expect(result.text).not.toContain('<');
  });

  it('rejects non-http schemes', async () => {
    const h = makeHarness();
    await expect(fetchUrlTool.run({ url: 'file:///etc/passwd' }, toolContext(h))).rejects.toThrow(/http/i);
  });
});
