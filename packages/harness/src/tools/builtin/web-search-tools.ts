/**
 * Built-in web search tool (multi-source with site-aware query rewriting).
 *
 * Outbound network — gated by ChatPolicy / ApprovalGate as risk `network`.
 * Primary path is `@agntk/search` (DuckDuckGo → env-configured fallbacks).
 * When that chain fails (common on restricted networks), a keyless Bing HTML
 * scrape is used as a last resort so Work chat still has web answers.
 *
 * Site paths: when the query targets Douyin / Bilibili / Zhihu / GitHub / forums
 * (or the caller sets `sites`), the tool rewrites into `site:` filters and may
 * fan out to a few sources, then merge/dedupe results.
 * @module
 */

import { createSearchClient, type SearchClient, type SearchResponse } from '@agntk/search';
import type { JsonValue } from '@camelia/core';

import type { Tool, ToolContext } from '../types.js';

interface WebSearchInput {
  query: string;
  maxResults?: number;
  /** Optional site shortcuts: douyin | bilibili | zhihu | github | forum | v2ex | reddit | stackoverflow */
  sites?: string[];
}

const DEFAULT_MAX = 5;
const HARD_MAX = 10;

/** Named site → hostname(s) used in `site:` filters. */
export const SITE_HOSTS: Record<string, string[]> = {
  douyin: ['douyin.com', 'iesdouyin.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
  zhihu: ['zhihu.com', 'zhuanlan.zhihu.com'],
  github: ['github.com'],
  forum: ['v2ex.com', 'linux.do', 'hostloc.com', 'nodeseek.com', '52pojie.cn'],
  v2ex: ['v2ex.com'],
  reddit: ['reddit.com'],
  stackoverflow: ['stackoverflow.com', 'stackexchange.com'],
  juejin: ['juejin.cn'],
  csdn: ['csdn.net', 'blog.csdn.net'],
  sspai: ['sspai.com'],
  youtube: ['youtube.com', 'youtu.be'],
  x: ['x.com', 'twitter.com'],
};

const SITE_HINT_PATTERNS: Array<{ re: RegExp; sites: string[] }> = [
  { re: /抖音|douyin/i, sites: ['douyin'] },
  { re: /哔哩哔哩|bilibili|b站|B站/i, sites: ['bilibili'] },
  { re: /知乎|zhihu/i, sites: ['zhihu'] },
  { re: /\bgithub\b|GitHub/i, sites: ['github'] },
  { re: /\bv2ex\b/i, sites: ['v2ex'] },
  { re: /掘金|juejin/i, sites: ['juejin'] },
  { re: /\bcsdn\b/i, sites: ['csdn'] },
  { re: /少数派|sspai/i, sites: ['sspai'] },
  { re: /\breddit\b/i, sites: ['reddit'] },
  { re: /stackoverflow|stack\s*overflow/i, sites: ['stackoverflow'] },
  { re: /论坛|forum/i, sites: ['forum'] },
];

/** Optional override for tests — keeps vitest off the public internet. */
let searchOverride: ((query: string, maxResults: number, signal: AbortSignal) => Promise<SearchResponse>) | undefined;

/** Test-only: replace the live search client. Pass undefined to restore. */
export function setWebSearchOverrideForTests(
  fn: ((query: string, maxResults: number, signal: AbortSignal) => Promise<SearchResponse>) | undefined,
): void {
  searchOverride = fn;
}

function resolveClient(): SearchClient {
  const tavilyKey =
    process.env.CAMELIA_TAVILY_API_KEY?.trim() ||
    process.env.TAVILY_API_KEY?.trim() ||
    undefined;
  if (tavilyKey) {
    return createSearchClient({
      provider: 'tavily',
      providers: { tavily: { apiKey: tavilyKey } },
      defaults: { maxResults: DEFAULT_MAX, safeSearch: 'moderate', timeout: 15_000 },
    });
  }
  return createSearchClient({
    defaults: { maxResults: DEFAULT_MAX, safeSearch: 'moderate', timeout: 15_000 },
  });
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('web_search aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new Error('web_search aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Infer site shortcuts from natural-language hints when the caller did not pass `sites`.
 */
export function inferSitesFromQuery(query: string): string[] {
  const found = new Set<string>();
  for (const { re, sites } of SITE_HINT_PATTERNS) {
    if (re.test(query)) for (const s of sites) found.add(s);
  }
  return [...found];
}

/**
 * Build one or more rewritten queries: open web + optional `site:` variants.
 *
 * When sites are present we keep a plain query (for recall) and add up to two
 * site-filtered queries so forum / video / GitHub hits are not drowned out.
 */
export function buildSearchQueries(query: string, sites: string[]): string[] {
  const base = query.trim().replace(/\s+/g, ' ');
  if (!base) return [];
  const hosts: string[] = [];
  for (const key of sites) {
    const list = SITE_HOSTS[key.toLowerCase()];
    if (list) hosts.push(...list);
    else if (key.includes('.')) hosts.push(key);
  }
  const uniqueHosts = [...new Set(hosts)].slice(0, 6);
  if (uniqueHosts.length === 0) return [base];

  const siteQueries = uniqueHosts.slice(0, 3).map((host) => {
    // Strip redundant site name tokens from the free-text part to avoid "zhihu site:zhihu.com".
    const stripped = base
      .replace(new RegExp(`\\b${host.replace(/\./g, '\\.')}\\b`, 'ig'), ' ')
      .replace(/抖音|douyin|哔哩哔哩|bilibili|b站|B站|知乎|zhihu|github|v2ex|掘金|juejin|论坛/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const q = stripped || base;
    return `${q} site:${host}`;
  });

  // Plain query first for general recall, then site filters.
  const out = [base, ...siteQueries];
  return [...new Set(out)].slice(0, 4);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function mergeResponses(query: string, parts: SearchResponse[], maxResults: number): SearchResponse {
  const seen = new Set<string>();
  const results: SearchResponse['results'] = [];
  let provider = parts[0]?.provider ?? 'merged';
  let durationMs = 0;
  let fallback = false;
  for (const part of parts) {
    durationMs += part.durationMs ?? 0;
    if (part.fallback) fallback = true;
    if (parts.length > 1) provider = 'multi';
    for (const r of part.results) {
      const key = normalizeUrl(r.url);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(r);
      if (results.length >= maxResults) break;
    }
    if (results.length >= maxResults) break;
  }
  return { query, provider, durationMs, results, fallback };
}

/**
 * Keyless Bing HTML scrape — last-resort when @agntk/search providers are unreachable.
 */
async function bingHtmlFallback(query: string, maxResults: number, signal: AbortSignal): Promise<SearchResponse> {
  const started = Date.now();
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(maxResults + 2, 12)}`;
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
  if (!res.ok) throw new Error(`bing HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchResponse['results'] = [];
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) ?? [];
  for (const block of blocks) {
    if (results.length >= maxResults) break;
    const href = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/i)?.[1];
    const titleRaw = block.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const snippetRaw =
      block.match(/<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ??
      block.match(/<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ??
      '';
    if (!href || !titleRaw) continue;
    const title = titleRaw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const snippet = snippetRaw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    results.push({ title, url: href, snippet, source: 'bing' });
  }
  if (results.length === 0) throw new Error('bing HTML returned no parseable results');
  return {
    query,
    provider: 'bing-html',
    durationMs: Date.now() - started,
    results,
    fallback: true,
  };
}

async function runOneSearch(query: string, maxResults: number, signal: AbortSignal): Promise<SearchResponse> {
  if (searchOverride) return searchOverride(query, maxResults, signal);
  try {
    return await withAbort(resolveClient().search(query, { maxResults, timeout: 15_000 }), signal);
  } catch (primaryError) {
    const primaryMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    try {
      return await bingHtmlFallback(query, maxResults, signal);
    } catch (fallbackError) {
      const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `web_search failed (${primaryMsg}); bing fallback also failed (${fallbackMsg}). ` +
          'Set TAVILY_API_KEY or CAMELIA_TAVILY_API_KEY for a more reliable provider.',
      );
    }
  }
}

async function runSearch(
  query: string,
  maxResults: number,
  sites: string[],
  signal: AbortSignal,
): Promise<SearchResponse & { queries: string[] }> {
  const queries = buildSearchQueries(query, sites);
  const parts: SearchResponse[] = [];
  const errors: string[] = [];
  // Cap fan-out so latency stays bounded; run sequentially to avoid rate limits.
  for (const q of queries) {
    if (signal.aborted) throw new Error('web_search aborted');
    try {
      const part = await runOneSearch(q, maxResults, signal);
      if (part.results.length) parts.push(part);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (parts.length === 0) {
    throw new Error(
      errors[0] ??
        `web_search returned no results for ${JSON.stringify(query)}. ` +
          'Set TAVILY_API_KEY or CAMELIA_TAVILY_API_KEY for a more reliable provider.',
    );
  }
  const merged = mergeResponses(query, parts, maxResults);
  return { ...merged, queries };
}

export const webSearchTool: Tool<WebSearchInput, JsonValue> = {
  name: 'web_search',
  description:
    'Search the public web for current facts, docs, or news outside the workspace. ' +
    'Supports site shortcuts (Douyin, Bilibili, Zhihu, GitHub, forums, …) via `sites` or query hints. Network risk.',
  usage: [
    'web_search(query, maxResults?, sites?)',
    '- query: natural-language search string (Chinese or English).',
    '- maxResults: 1-10 (default 5).',
    '- sites: optional list of shortcuts — douyin, bilibili, zhihu, github, forum, v2ex, reddit, stackoverflow, juejin, csdn, sspai, youtube, x.',
    '- Query text that mentions 抖音/B站/知乎/GitHub/论坛 also auto-adds matching site: filters.',
    '- Returns { provider, query, queries, count, results: [{ title, url, snippet }] }.',
    '- Default provider is DuckDuckGo via @agntk/search; Bing HTML is a last-resort fallback.',
    '- Set TAVILY_API_KEY or CAMELIA_TAVILY_API_KEY to prefer Tavily.',
    '- Cite URLs from results; never invent links.',
    '- Empty results are an error — stop and tell the user; never conclude a page or contest "does not exist" from an empty hit list.',
  ].join('\n'),
  risk: 'network',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language web search query.' },
      maxResults: { type: 'integer', description: 'Cap on results (default 5, max 10).' },
      sites: {
        type: 'array',
        description: 'Optional site shortcuts (douyin, bilibili, zhihu, github, forum, …).',
        items: { type: 'string' },
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async run(input, ctx: ToolContext) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) throw new Error('query must be a non-empty string');
    const maxResults = Math.min(Math.max(input.maxResults ?? DEFAULT_MAX, 1), HARD_MAX);
    const explicit = Array.isArray(input.sites)
      ? input.sites.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      : [];
    const sites = [...new Set([...explicit, ...inferSitesFromQuery(query)])];

    const response = await runSearch(query, maxResults, sites, ctx.signal);
    if (!response.results.length) {
      throw new Error(
        `web_search returned no results for ${JSON.stringify(query)} (provider=${response.provider}). ` +
          'Do not invent facts, links, or conclusions such as "the contest/problem does not exist". ' +
          'Report this empty result to the user, stop, and ask whether to retry with a different query or open a known URL directly.',
      );
    }

    return {
      provider: response.provider,
      query: response.query || query,
      queries: response.queries,
      ...(sites.length ? { sites } : {}),
      count: response.results.length,
      results: response.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      })),
    };
  },
};

export const webSearchTools: Tool<any, any>[] = [webSearchTool];
