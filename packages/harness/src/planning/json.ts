/**
 * Tolerant JSON extraction.
 *
 * Free models wrap JSON in prose and markdown fences, and sometimes truncate it.
 * We never trust `JSON.parse` on the raw output (whitepaper §5.5): we locate the
 * first balanced object and repair the two most common defects (trailing commas,
 * unbalanced tail) before giving up.
 * @module
 */

/** Strip ```json fences if present. */
export function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

/**
 * Return the first balanced `{...}` block, respecting string literals and escapes.
 * Returns undefined when no balanced object exists.
 */
export function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Remove trailing commas before a closing brace/bracket. */
export function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Best-effort parse of a JSON object out of model output.
 * Returns undefined rather than throwing — callers fall back deterministically.
 *
 * Arrays are rejected on purpose: `typeof [] === 'object'`, so a naive check lets
 * `[1,2,3]` through and every caller then reads `.steps` off an array and plans
 * nothing. A top-level array is a hallucination-shaped output, not a plan.
 */
export function extractJsonObject<T = unknown>(raw: string): T | undefined {
  const cleaned = stripFences(raw);
  const candidate = firstBalancedObject(cleaned) ?? cleaned;
  const attempts = [candidate, stripTrailingCommas(candidate), stripTrailingCommas(cleaned)];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
    } catch {
      // try the next repair
    }
  }
  return undefined;
}

/** Extract a fenced block for a specific path — used when tools are unavailable. */
export function extractFencedBlocks(text: string): { label: string; body: string }[] {
  const blocks: { label: string; body: string }[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    blocks.push({ label: (match[1] ?? '').trim(), body: match[2] ?? '' });
  }
  return blocks;
}