/**
 * Built-in web search tool (DuckDuckGo by default, optional Tavily).
 *
 * Outbound network — gated by ChatPolicy / ApprovalGate as risk `network`.
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

export const webSearchTool: Tool<WebSearchInput, JsonValue> = {
  name: 'web_search',
  description:
    'Search the public web for current facts, docs, or news outside the workspace. Network risk.',
  usage: [
    'web_search(query, maxResults?)',
    '- query: natural-language search string.',
    '- maxResults: 1-10 (default 5).',
    '- Returns { provider, query, count, results: [{ title, url, snippet }] }.',
    '- Default provider is DuckDuckGo (no key). Set TAVILY_API_KEY or CAMELIA_TAVILY_API_KEY to prefer Tavily.',
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

    const response = searchOverride
      ? await searchOverride(query, maxResults, ctx.signal)
      : await withAbort(resolveClient().search(query, { maxResults, timeout: 15_000 }), ctx.signal);

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
