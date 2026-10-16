/**
 * Site-aware query rewriting for web_search.
 * @module
 */
import { describe, expect, it } from 'vitest';

import { buildSearchQueries, inferSitesFromQuery, SITE_HOSTS } from '../src/tools/builtin/web-search-tools.js';

describe('inferSitesFromQuery', () => {
  it('detects Chinese and English site hints', () => {
    expect(inferSitesFromQuery('知乎上怎么看这个问题')).toContain('zhihu');
    expect(inferSitesFromQuery('B站教程 ffmpeg')).toContain('bilibili');
    expect(inferSitesFromQuery('douyin 热搜')).toContain('douyin');
    expect(inferSitesFromQuery('github actions cache')).toContain('github');
    expect(inferSitesFromQuery('这个论坛里有人讨论过吗')).toContain('forum');
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
});
