/**
 * Built-in web search tool (DuckDuckGo by default, optional Tavily).
 *
 * Outbound network — gated by ChatPolicy / ApprovalGate as risk `network`.
 * Primary path is `@agntk/search` (DuckDuckGo → env-configured fallbacks).
 * When that chain fails (common on restricted networks), a keyless Bing HTML
 * scrape is used as a last resort so Work chat still has web answers.
 * @module
 */

import { createSearchClient, type SearchClient, type SearchResponse } from '@agntk/search';
import type { JsonValue } from '@camelia/core';

import type { Tool, ToolContext } from '../types.js';

interface WebSearchInput {
  query: string;
  maxResults?: number;
}

const DEFAULT_MAX = 5;
const HARD_MAX = 10;

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
  // No key → DuckDuckGo first, with automatic fallback if other providers appear via env.
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
 * Keyless Bing HTML scrape — last-resort when @agntk/search providers are unreachable
 * (e.g. DuckDuckGo VQD blocked). Best-effort parsing; not a stable public API.
 */
async function bingHtmlFallback(query: string, maxResults: number, signal: AbortSignal): Promise<SearchResponse> {
  const started = Date.now();
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`bing HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchResponse['results'] = [];
  // Each organic result is typically an <li class="b_algo">…</li> block.
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

async function runSearch(query: string, maxResults: number, signal: AbortSignal): Promise<SearchResponse> {
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

export const webSearchTool: Tool<WebSearchInput, JsonValue> = {
  name: 'web_search',
  description:
    'Search the public web for current facts, docs, or news outside the workspace. Network risk.',
  usage: [
    'web_search(query, maxResults?)',
    '- query: natural-language search string.',
    '- maxResults: 1-10 (default 5).',
    '- Returns { provider, query, count, results: [{ title, url, snippet }] }.',
    '- Default provider is DuckDuckGo via @agntk/search; Bing HTML is a last-resort fallback.',
    '- Set TAVILY_API_KEY or CAMELIA_TAVILY_API_KEY to prefer Tavily.',
    '- Cite URLs from results; never invent links.',
  ].join('\n'),
  risk: 'network',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language web search query.' },
      maxResults: { type: 'integer', description: 'Cap on results (default 5, max 10).' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async run(input, ctx: ToolContext) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) throw new Error('query must be a non-empty string');
    const maxResults = Math.min(Math.max(input.maxResults ?? DEFAULT_MAX, 1), HARD_MAX);

    const response = await runSearch(query, maxResults, ctx.signal);

    return {
      provider: response.provider,
      query: response.query || query,
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
