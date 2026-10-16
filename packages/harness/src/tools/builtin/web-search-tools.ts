/**
 * Built-in web search + fetch_url (multi-source, site-aware, ranked).
 *
 * Outbound network — gated by ChatPolicy / ApprovalGate as risk `network`.
 * Primary path is `@agntk/search` (DuckDuckGo → env-configured fallbacks).
 * When that chain fails (common on restricted networks), a keyless Bing HTML
 * scrape is used as a last resort so Work chat still has web answers.
 *
 * Architecture (search reliability):
 * - Site shortcuts + CUMCM/数模 auto site:mcm.edu.cn query fan-out
 * - Prefer official/edu/github hosts when merging results
 * - Soft gate: empty/irrelevant → status no_reliable_sources (未找到可靠来源)
 *   instead of letting the model invent titles/dates/"does not exist"
 * - Thin official snippets may be enriched via an internal page fetch
 * - fetch_url tool for deliberate page reads of known URLs
 * @module
 */

import { createSearchClient, type SearchClient, type SearchResponse } from '@agntk/search';
import type { JsonValue } from '@camelia/core';

import type { Tool, ToolContext } from '../types.js';

interface WebSearchInput {
  query: string;
  maxResults?: number;
  /** Optional site shortcuts: douyin | bilibili | zhihu | github | forum | mcm | … */
  sites?: string[];
}

interface FetchUrlInput {
  url: string;
  /** Max characters of extracted text (default 4000, hard max 12000). */
  maxChars?: number;
}

const DEFAULT_MAX = 5;
const HARD_MAX = 10;
const FETCH_DEFAULT_CHARS = 4000;
const FETCH_HARD_MAX = 12_000;
const THIN_SNIPPET = 80;

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
  mcm: ['mcm.edu.cn', 'www.mcm.edu.cn'],
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
  { re: /数模|数学建模|CUMCM|\bmcm\.edu\.cn\b|全国大学生数学建模/i, sites: ['mcm'] },
];

/** Host preference scores used when merging multi-query results. */
const HOST_RANK: Array<{ re: RegExp; score: number }> = [
  { re: /(^|\.)mcm\.edu\.cn$/i, score: 100 },
  { re: /(^|\.)edu\.cn$/i, score: 85 },
  { re: /(^|\.)github\.com$/i, score: 75 },
  { re: /(^|\.)edu$/i, score: 70 },
  { re: /(^|\.)ac\.cn$/i, score: 65 },
  { re: /(^|\.)zhihu\.com$/i, score: 40 },
  { re: /(^|\.)wikipedia\.org$/i, score: 35 },
];

/** Known CUMCM problem title hints — bias search when year/letter/topic match. */
const CUMCM_TITLE_HINTS: Array<{
  year: number;
  letter: string;
  topics: RegExp;
  titleZh: string;
  extraQueries: string[];
}> = [
  {
    year: 2025,
    letter: 'B',
    topics: /碳化硅|SiC|外延|Drude|Sellmeier|反演/i,
    titleZh: '基于 Drude-Sellmeier 模型的碳化硅外延层厚度的反演算法',
    extraQueries: [
      'site:mcm.edu.cn 2025 B题 碳化硅',
      'site:mcm.edu.cn Drude-Sellmeier 碳化硅 外延层',
      'site:mcm.edu.cn 2025 Problem B silicon carbide',
    ],
  },
];

const NO_RELIABLE_INSTRUCTION =
  '未找到可靠来源. Do NOT invent contest/problem titles, dates, publication status, or reasons. ' +
  'Empty or irrelevant web_search is a tool failure, NOT evidence that a contest or problem does not exist. ' +
  'Tell the user 未找到可靠来源, cite what was tried (queries), and suggest site:mcm.edu.cn, a known official URL, or retry.';

/** Optional override for tests — keeps vitest off the public internet. */
let searchOverride: ((query: string, maxResults: number, signal: AbortSignal) => Promise<SearchResponse>) | undefined;

/** Optional page-fetch override for tests. */
let fetchOverride: ((url: string, signal: AbortSignal) => Promise<string>) | undefined;

/** Test-only: replace the live search client. Pass undefined to restore. */
export function setWebSearchOverrideForTests(
  fn: ((query: string, maxResults: number, signal: AbortSignal) => Promise<SearchResponse>) | undefined,
): void {
  searchOverride = fn;
}

/** Test-only: replace page fetch used by fetch_url / snippet enrichment. */
export function setFetchUrlOverrideForTests(
  fn: ((url: string, signal: AbortSignal) => Promise<string>) | undefined,
): void {
  fetchOverride = fn;
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

export interface DomainQueryHints {
  cumcm: boolean;
  sic: boolean;
  year?: number;
  problemLetter?: string;
}

/** Detect CUMCM / 数模 / SiC / year / problem-letter cues for query expansion. */
export function detectDomainHints(query: string): DomainQueryHints {
  const cumcm = /数模|数学建模|CUMCM|\bmcm\.edu\.cn\b|全国大学生数学建模/i.test(query);
  const sic = /碳化硅|\bSiC\b|外延层|Drude|Sellmeier/i.test(query);
  const yearMatch = query.match(/\b(20(?:2[0-9]|3[0-9]))\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  let problemLetter: string | undefined;
  const letterMatch =
    query.match(/(?:^|[^A-Za-z0-9_])([A-F])\s*题(?![A-Za-z0-9_])/i) ??
    query.match(/题\s*([A-F])(?![A-Za-z0-9_])/i) ??
    query.match(/\bProblem\s*([A-F])\b/i) ??
    query.match(/(?:^|[^A-Za-z0-9_])B\s*题/i);
  if (letterMatch) {
    problemLetter = (letterMatch[1] ?? 'B').toUpperCase();
  }
  return { cumcm, sic, year, problemLetter };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** Rank score for a result URL (higher = prefer). */
export function hostRankScore(url: string): number {
  const host = hostnameOf(url);
  if (!host) return 0;
  if (/mcm\.edu\.cn/i.test(url) && /\/html_cn\/node\/|\/upload_en\/node\//i.test(url)) return 110;
  for (const { re, score } of HOST_RANK) {
    if (re.test(host)) return score;
  }
  return 0;
}

export function isPreferredOfficialHost(url: string): boolean {
  return hostRankScore(url) >= 70;
}

/**
 * Build one or more rewritten queries: open web + optional `site:` variants +
 * CUMCM/数模 official-site expansions.
 */
export function buildSearchQueries(query: string, sites: string[]): string[] {
  const base = query.trim().replace(/\s+/g, ' ');
  if (!base) return [];
  const hints = detectDomainHints(base);
  const siteKeys = [...sites];
  if (hints.cumcm && !siteKeys.includes('mcm')) siteKeys.push('mcm');

  const hosts: string[] = [];
  for (const key of siteKeys) {
    const list = SITE_HOSTS[key.toLowerCase()];
    if (list) hosts.push(...list);
    else if (key.includes('.')) hosts.push(key);
  }
  const uniqueHosts = [...new Set(hosts)].slice(0, 6);

  const siteQueries = uniqueHosts.slice(0, 3).map((host) => {
    const stripped = base
      .replace(new RegExp(`\\b${host.replace(/\./g, '\\.')}\\b`, 'ig'), ' ')
      .replace(/抖音|douyin|哔哩哔哩|bilibili|b站|B站|知乎|zhihu|github|v2ex|掘金|juejin|论坛/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const q = stripped || base;
    return `${q} site:${host}`;
  });

  const out: string[] = [base, ...siteQueries];

  if (hints.cumcm) {
    const y = hints.year ? String(hints.year) : '';
    const letter = hints.problemLetter ?? '';
    if (y && letter) {
      out.push(`site:mcm.edu.cn ${y} ${letter}题`);
      out.push(`site:mcm.edu.cn ${y} Problem ${letter}`);
    } else if (y) {
      out.push(`site:mcm.edu.cn ${y} 竞赛试题`);
    } else {
      out.push('site:mcm.edu.cn 竞赛试题');
    }
    if (hints.sic) {
      out.push('site:mcm.edu.cn 碳化硅');
      out.push('site:mcm.edu.cn SiC epitaxial');
    }
    for (const hint of CUMCM_TITLE_HINTS) {
      const yearOk = !hints.year || hints.year === hint.year;
      const letterOk = !hints.problemLetter || hints.problemLetter === hint.letter;
      const topicOk = hints.sic || hint.topics.test(base);
      if (yearOk && letterOk && topicOk) {
        out.push(...hint.extraQueries);
        out.push(`site:mcm.edu.cn ${hint.titleZh}`);
      }
    }
  }

  return [...new Set(out.filter(Boolean))].slice(0, 6);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    if (/bing\.com$/i.test(u.hostname) && u.pathname.includes('/ck/')) {
      const uParam = u.searchParams.get('u');
      if (uParam) {
        try {
          const decoded = decodeURIComponent(uParam.replace(/^a1/, ''));
          if (decoded.startsWith('http')) return normalizeUrl(decoded);
        } catch {
          /* keep original */
        }
      }
    }
    return u.href.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function sortByHostRank(results: SearchResponse['results']): SearchResponse['results'] {
  return [...results].sort((a, b) => hostRankScore(b.url) - hostRankScore(a.url));
}

function mergeResponses(query: string, parts: SearchResponse[], maxResults: number): SearchResponse {
  const seen = new Set<string>();
  const pooled: SearchResponse['results'] = [];
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
      pooled.push({ ...r, url: key });
    }
  }
  const ranked = sortByHostRank(pooled).slice(0, maxResults);
  return { query, provider, durationMs, results: ranked, fallback };
}

/** Tokenize a query for crude relevance checks (zh bigrams + en words). */
export function queryTokens(query: string): string[] {
  const tokens = new Set<string>();
  for (const m of query.match(/[A-Za-z][A-Za-z0-9_-]{1,}|[0-9]{4}|[\u4e00-\u9fff]{2,}/g) ?? []) {
    const t = m.toLowerCase();
    if (t.length >= 2) tokens.add(t);
  }
  return [...tokens];
}

/**
 * True when at least one result looks on-topic or comes from a preferred host
 * for domain queries (CUMCM → mcm.edu.cn counts even with thin snippets).
 */
export function resultsAreRelevant(query: string, results: SearchResponse['results']): boolean {
  if (!results.length) return false;
  const hints = detectDomainHints(query);
  // Strict irrelevance gate only for domains where models hallucinate absences/titles.
  if (!hints.cumcm && !hints.sic) return true;
  if (hints.cumcm && results.some((r) => /mcm\.edu\.cn/i.test(r.url))) return true;
  if (results.some((r) => isPreferredOfficialHost(r.url))) return true;

  const tokens = queryTokens(query).filter((t) => !/^(site|www|http|https|com|cn|the|and|for)$/i.test(t));
  if (tokens.length === 0) return true;
  const significant = tokens.filter((t) => t.length >= 2);
  let hits = 0;
  for (const r of results) {
    const blob = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
    const matched = significant.filter((t) => blob.includes(t.toLowerCase()));
    if (matched.length >= Math.min(2, significant.length)) hits += 1;
    if (hints.sic && /碳化硅|sic|drude|sellmeier/i.test(blob)) hits += 1;
    if (hints.cumcm && /数模|数学建模|cumcm|mcm\.edu/i.test(blob)) hits += 1;
  }
  return hits > 0;
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
    results: sortByHostRank(results),
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
    return {
      query,
      provider: 'none',
      durationMs: 0,
      results: [],
      fallback: true,
      queries,
    };
  }
  const merged = mergeResponses(query, parts, maxResults);
  return { ...merged, queries };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPageText(url: string, signal: AbortSignal): Promise<string> {
  if (fetchOverride) {
    const raw = await fetchOverride(url, signal);
    return stripHtml(raw);
  }
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
  if (!res.ok) throw new Error(`fetch_url HTTP ${res.status}`);
  const ctype = res.headers.get('content-type') ?? '';
  if (!/text\/|json|xml|html/i.test(ctype) && ctype) {
    throw new Error(`fetch_url unsupported content-type: ${ctype}`);
  }
  const raw = await res.text();
  return stripHtml(raw);
}

async function enrichThinOfficialSnippets(
  results: SearchResponse['results'],
  signal: AbortSignal,
): Promise<SearchResponse['results']> {
  const out = results.map((r) => ({ ...r }));
  let enriched = 0;
  for (const r of out) {
    if (enriched >= 2) break;
    if (!isPreferredOfficialHost(r.url)) continue;
    if ((r.snippet ?? '').trim().length >= THIN_SNIPPET) continue;
    try {
      const text = await fetchPageText(r.url, signal);
      if (text.length > 40) {
        r.snippet = text.slice(0, 900);
        enriched += 1;
      }
    } catch {
      /* keep thin snippet */
    }
  }
  return out;
}

function noReliablePayload(query: string, queries: string[], reason: string, sample?: SearchResponse['results']) {
  return {
    status: 'no_reliable_sources' as const,
    message: '未找到可靠来源',
    reason,
    instruction: NO_RELIABLE_INSTRUCTION,
    query,
    queries,
    count: 0,
    results: [] as { title: string; url: string; snippet: string }[],
    ...(sample?.length
      ? {
          discardedSample: sample.slice(0, 3).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: (r.snippet ?? '').slice(0, 120),
          })),
        }
      : {}),
  };
}

export const webSearchTool: Tool<WebSearchInput, JsonValue> = {
  name: 'web_search',
  description:
    'Search the public web. Prefers official/edu hosts; CUMCM/数模 auto site:mcm.edu.cn. Empty/irrelevant → 未找到可靠来源. Network risk.',
  usage: [
    'web_search(query, maxResults?, sites?)',
    '- query: natural-language search (zh/en).',
    '- maxResults: 1-10 (default 5).',
    '- sites: douyin, bilibili, zhihu, github, forum, mcm, v2ex, reddit, stackoverflow, juejin, csdn, sspai, youtube, x.',
    '- 数模/CUMCM/碳化硅 hints auto-add site:mcm.edu.cn and title-biased queries.',
    '- Returns { status?, provider, query, queries, count, results } or { status:"no_reliable_sources", message:"未找到可靠来源" }.',
    '- On no_reliable_sources: say 未找到可靠来源; never invent titles/dates/"does not exist".',
    '- Cite result URLs; use fetch_url on thin official hits. TAVILY_API_KEY improves recall.',
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
        description: 'Optional site shortcuts (douyin, bilibili, zhihu, github, mcm, forum, …).',
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
      return noReliablePayload(query, response.queries, 'empty_results');
    }

    if (!resultsAreRelevant(query, response.results)) {
      return noReliablePayload(query, response.queries, 'irrelevant_results', response.results);
    }

    const enriched = await enrichThinOfficialSnippets(response.results, ctx.signal);

    return {
      status: 'ok' as const,
      provider: response.provider,
      query: response.query || query,
      queries: response.queries,
      ...(sites.length ? { sites } : {}),
      count: enriched.length,
      results: enriched.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        hostRank: hostRankScore(r.url),
      })),
    };
  },
};

export const fetchUrlTool: Tool<FetchUrlInput, JsonValue> = {
  name: 'fetch_url',
  description:
    'Fetch a public http(s) page as readable text. Use on official URLs from web_search when snippets are thin. Network risk.',
  usage: [
    'fetch_url(url, maxChars?)',
    '- url: absolute http or https URL (prefer mcm.edu.cn / github / edu from web_search).',
    '- maxChars: 1-12000 (default 4000).',
    '- Returns { url, finalUrl?, chars, text }. HTML is stripped to plain text.',
    '- Do not invent page content if fetch fails; report the error.',
  ].join('\n'),
  risk: 'network',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
      maxChars: { type: 'integer', description: 'Max characters of extracted text (default 4000).' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async run(input, ctx: ToolContext) {
    const raw = typeof input.url === 'string' ? input.url.trim() : '';
    if (!raw) throw new Error('url must be a non-empty string');
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('url must be an absolute http(s) URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('url must use http or https');
    }
    const maxChars = Math.min(Math.max(input.maxChars ?? FETCH_DEFAULT_CHARS, 1), FETCH_HARD_MAX);
    const text = await fetchPageText(parsed.href, ctx.signal);
    const clipped = text.slice(0, maxChars);
    return {
      url: parsed.href,
      chars: clipped.length,
      truncated: text.length > maxChars,
      text: clipped,
    };
  },
};

export const webSearchTools: Tool<any, any>[] = [webSearchTool, fetchUrlTool];
