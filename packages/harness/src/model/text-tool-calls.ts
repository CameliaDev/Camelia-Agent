/**
 * Text-embedded tool call recovery.
 *
 * ## Why this exists
 *
 * `Executor` acts on `response.toolCalls` — the structured field. Some models
 * never populate it: they understand the tool perfectly and *describe* the call
 * as text instead. Measured on `qwen2.5-coder:7b` via Ollama 0.40.2, with the
 * `tools` parameter supplied, the model replies with:
 *
 * ```
 * <tools>{{"name": "fs.mkdir", "arguments": {"path": "src"}}}</tools>
 * ```
 *
 * — its own invented wrapper tag, plus **doubled braces** from having been
 * taught to write JSON inside a template. `tool_calls` is empty and
 * `finish_reason` is `stop`.
 *
 * The consequence of ignoring this is the worst kind of failure: the model
 * produces a good plan, emits no structured call, `toolCalls` comes back empty,
 * and `Executor` reads that as "the step is finished". The task reports
 * progress, changes nothing, and fails at the end complaining about a file that
 * was never written.
 *
 * ## Approach
 *
 * Find candidate *regions* (fenced blocks, `<tools>` wrappers, whole lines),
 * then extract the balanced JSON object from each with a real brace scanner
 * rather than a regex. Regex cannot express "match a balanced object", and
 * trying made the doubled-brace cases fragile.
 *
 * ## What this is not
 *
 * Not a general "let the model write code instead". Every recovered call is
 * validated: the tool name must be one the caller actually offered, and the
 * arguments must parse as a JSON object. A misread block could otherwise run a
 * command the user never approved, so a false positive is far worse than a
 * false negative.
 *
 * @module
 */

import type { JsonValue, LLMToolCall, LLMToolSchema } from '@camelia/core';

/** Candidate keys a model may use for the tool name, in priority order. */
const NAME_KEYS = ['tool', 'name', 'tool_name', 'toolName', 'function'] as const;

/** Candidate keys for the argument payload. */
const ARGS_KEYS = ['arguments', 'args', 'parameters', 'input', 'arguments_json'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Find every balanced `{...}` region in `text`, skipping braces inside strings.
 *
 * Returns the substring and its start offset. A brace counter alone would break
 * on `{"path": "a{b"}`, so string literals are tracked explicitly.
 *
 * Also returns a *truncated* tail when the text ends inside an object: a model
 * cut off by a token limit leaves an unclosed brace, and discarding it would
 * throw away a call the model clearly intended.
 */
function scanObjects(text: string): Array<{ body: string; truncated: boolean }> {
  const found: Array<{ body: string; truncated: boolean }> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        found.push({ body: text.slice(start, i + 1), truncated: false });
        start = -1;
      }
    }
  }

  // Unclosed object at the end of the stream: recover it so a token limit does
  // not discard a call the model was in the middle of making.
  if (depth > 0 && start >= 0) {
    found.push({ body: text.slice(start), truncated: true });
  }
  return found;
}

/**
 * Close a truncated object so it can be parsed.
 *
 * A cut-off call is missing its closing braces and possibly the tail of its last
 * string value. Repair is best-effort: if the result does not parse, `toCall`
 * rejects it exactly like any other malformed candidate.
 */
function closeTruncated(body: string): string {
  let out = body.trimEnd();
  // A dangling key (`"path":` with no value) must be **removed**, not closed
  // into `"path": ""`. Inventing an empty value would fabricate an argument the
  // model never chose — and writing to the wrong path is worse than not calling
  // at all.
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  out = out.replace(/"[^"]*"\s*:\s*$/, '');
  // An unterminated string swallows the rest, so close it before the braces.
  let opens = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') opens += 1;
    else if (ch === '}') opens -= 1;
  }
  if (inString) out += '"';
  while (opens > 0) {
    out += '}';
    opens -= 1;
  }
  return out;
}

/** Read a tool name from a parsed object, trying each known key. */
function readName(obj: Record<string, unknown>): string | undefined {
  for (const key of NAME_KEYS) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    // OpenAI-style: {"function": {"name": "fs.write"}}
    if (key === 'function' && isRecord(value) && typeof value.name === 'string' && value.name.trim()) {
      return value.name.trim();
    }
  }
  return undefined;
}

/** Read the argument payload, parsing it when it arrived as a JSON string. */
function readArguments(obj: Record<string, unknown>): JsonValue | undefined {
  for (const key of ARGS_KEYS) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        if (isRecord(parsed) || Array.isArray(parsed)) return parsed as JsonValue;
      } catch {
        /* not JSON; try the next key */
      }
      continue;
    }
    if (isRecord(value) || Array.isArray(value)) return value as JsonValue;
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  }
  return undefined;
}

/**
 * Reduce a captured body to parseable JSON.
 *
 * A model that doubles braces (`{{...}}}`) produces a body whose counts already
 * balance — the extra brace on each side is the escape, not structure. So
 * counting cannot distinguish them; the escape is identified positionally:
 * a leading `{{` and a trailing `}}` beyond the object's own single brace.
 *
 * Handling: strip one leading brace when the body starts `{{`, and strip from
 * the end until the depth is exactly zero *and* the leading escape is gone.
 * Concretely — remove the leading `{{` down to one `{`, then trim trailing `}`
 * until the string parses. Tries the direct parse first so well-formed JSON is
 * never modified.
 */
function balance(body: string): string {
  const attempts: string[] = [body];

  // Leading escape: `{{` -> `{`
  if (body.startsWith('{{')) attempts.push(body.slice(1));

  // Leading escape plus trailing escapes: try peeling 0..2 trailing braces off
  // each leading variant, keeping only balanced results.
  for (const base of [body, body.startsWith('{{') ? body.slice(1) : body]) {
    for (let drop = 0; drop <= 2; drop += 1) {
      attempts.push(base.slice(0, base.length - drop));
    }
  }

  for (const candidate of attempts) {
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* try the next variant */
    }
  }
  return body;
}

/** Turn one candidate body into a tool call, or `undefined` if it isn't one. */
function toCall(body: string, offered: ReadonlySet<string>, truncated: boolean): LLMToolCall | undefined {
  const candidates = truncated ? [closeTruncated(body), body] : [body];
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(balance(candidate));
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const name = readName(parsed);
    // Rule: only tools the caller actually offered. A hallucinated name is
    // dropped here rather than forwarded to the engine.
    if (!name || !offered.has(name)) continue;
    return { id: `text-${name}`, name, arguments: readArguments(parsed) ?? {} };
  }
  return undefined;
}

export interface RecoverOptions {
  /** Tool names the caller offered. Anything else is discarded. */
  offeredTools: readonly LLMToolSchema[] | readonly string[];
}

function offeredNames(tools: readonly LLMToolSchema[] | readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const tool of tools) set.add(typeof tool === 'string' ? tool : tool.name);
  return set;
}

/**
 * Recover tool calls that a model wrote as text.
 *
 * @param text        The model's text output.
 * @param offeredTools Tools the caller actually offered.
 * @returns Calls in the order they appear, deduplicated by name. Empty when the
 *          text contains no recognisable call.
 */
export function recoverTextToolCalls(text: string, offeredTools: RecoverOptions['offeredTools']): LLMToolCall[] {
  if (!text || !text.includes('{')) return [];
  const offered = offeredNames(offeredTools);
  if (offered.size === 0) return [];

  const found: LLMToolCall[] = [];
  const seen = new Set<string>();

  for (const { body, truncated } of scanObjects(text)) {
    const call = toCall(body, offered, truncated);
    if (call && !seen.has(call.name)) {
      seen.add(call.name);
      found.push(call);
    }
  }

  return found;
}

/**
 * Remove recovered call regions from the text so the user reads narration only.
 *
 * Also removes the empty `<tools></tools>` shells left behind, which would
 * otherwise look like leaked protocol syntax.
 */
export function stripTextToolCalls(text: string): string {
  return (
    text
      // `<response>` was observed from qwen in streaming mode, wrapping the call
      // and sometimes truncated mid-object. The trailing `*` also covers an
      // unclosed tag left by a cut-off stream.
      .replace(/<response>[\s\S]*?(?:<\/response>|$)/gi, '')
      .replace(/<tools>[\s\S]*?(?:<\/tools>|$)/gi, '')
      .replace(/<tool_call>[\s\S]*?(?:<\/tool_calls?>|$)/gi, '')
      .replace(/```(?:json|tool_call|xml)?\s*\n?\s*\{[\s\S]*?\}\s*\n?\s*```/g, '')
      .replace(/^\s*\{[^\n]*"[a-z_]+"\s*:[^\n]*\}?\s*$/gim, '')
      // A stream cut mid-block leaves an unterminated fence. Leaving it visible
      // shows the user raw protocol syntax; drop the dangling opener.
      .replace(/```(?:json|tool_call|xml)?\s*$/i, '')
      .trim()
  );
}