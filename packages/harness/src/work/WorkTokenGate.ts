/**
 * Work token gate.
 *
 * A sub-AI states a goal, the constraints, and a short plan, and only then
 * receives a token. Tool calls with no active token are refused. A call outside
 * the token's tools, path bounds, or call budget returns the token to the parent
 * and does not run.
 * @module
 */

import { newId, type JsonValue } from '@camelia/core';

export interface WorkThought {
  goals: string[];
  constraints: string[];
  plan: string[];
}

export interface WorkTokenBounds {
  /** Tool names. `*` allows every tool the parent offered. An empty list allows none. */
  allowedTools: readonly string[];
  /** Workspace-relative prefixes. Empty means a path argument is not restricted. */
  pathPrefixes: readonly string[];
  maxToolCalls: number;
}

export interface WorkToken {
  id: string;
  holderId: string;
  thought: WorkThought;
  bounds: WorkTokenBounds;
  toolCalls: number;
  status: 'active' | 'returned';
  returnReason?: string;
}

export type WorkGateDecision =
  | { ok: true; token: WorkToken }
  | { ok: false; reason: string; handedBack: boolean; token?: WorkToken };

const PATH_KEYS = ['path', 'file', 'cwd', 'target'] as const;

export function pathFromToolInput(input: JsonValue): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, JsonValue>;
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** True when `path` sits on one of the prefixes. An empty prefix list does not restrict. */
export function pathWithinBounds(path: string, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return true;
  const norm = path.replace(/\\/g, '/');
  return prefixes.some((raw) => {
    const prefix = raw.replace(/\\/g, '/').replace(/\/$/, '');
    if (!prefix) return false;
    if (norm === prefix || norm.startsWith(`${prefix}/`)) return true;
    const rel = norm.replace(/^\.\//, '');
    const prel = prefix.replace(/^\.\//, '');
    return rel === prel || rel.startsWith(`${prel}/`) || norm.endsWith(`/${prel}`) || norm.includes(`/${prel}/`);
  });
}

function cleanList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

export class WorkTokenGate {
  private readonly tokens = new Map<string, WorkToken>();

  /**
   * Issue a token only after a thought that names a goal and a short plan.
   * A missing thought does not hand a previous token back — there is nothing to return.
   */
  issue(holderId: string, thought: WorkThought | undefined, bounds: WorkTokenBounds): WorkGateDecision {
    const goals = cleanList(thought?.goals);
    const plan = cleanList(thought?.plan);
    const constraints = cleanList(thought?.constraints);
    if (!holderId.trim() || goals.length === 0 || plan.length === 0) {
      return {
        ok: false,
        handedBack: false,
        reason: 'sub-AI must state a goal and a short plan before a token is issued',
      };
    }
    const token: WorkToken = {
      id: newId(),
      holderId: holderId.trim(),
      thought: { goals, constraints, plan },
      bounds: {
        allowedTools: [...bounds.allowedTools],
        pathPrefixes: [...bounds.pathPrefixes],
        maxToolCalls: Math.max(0, Math.floor(bounds.maxToolCalls)),
      },
      toolCalls: 0,
      status: 'active',
    };
    this.tokens.set(token.id, token);
    return { ok: true, token };
  }

  get(tokenId: string): WorkToken | undefined {
    return this.tokens.get(tokenId);
  }

  /**
   * Authorize one tool call.
   * No token: refuse, and do not pretend the call ran.
   * Out of bounds: mark the token returned and refuse the call.
   */
  authorize(tokenId: string | undefined, tool: string, input: JsonValue = {}): WorkGateDecision {
    if (!tokenId) {
      return { ok: false, handedBack: false, reason: 'no token — tools are refused' };
    }
    const token = this.tokens.get(tokenId);
    if (!token) {
      return { ok: false, handedBack: false, reason: 'no token — tools are refused' };
    }
    if (token.status === 'returned') {
      return {
        ok: false,
        handedBack: true,
        token,
        reason: token.returnReason ?? 'token already returned to the parent',
      };
    }
    const allowed = token.bounds.allowedTools;
    if (!allowed.includes('*') && !allowed.includes(tool)) {
      return this.handBack(token, `tool "${tool}" is outside the token`);
    }
    const path = pathFromToolInput(input);
    if (path && token.bounds.pathPrefixes.length > 0 && !pathWithinBounds(path, token.bounds.pathPrefixes)) {
      return this.handBack(token, `path "${path}" is outside the token bounds`);
    }
    if (token.toolCalls >= token.bounds.maxToolCalls) {
      return this.handBack(token, 'tool-call budget exhausted');
    }
    token.toolCalls += 1;
    return { ok: true, token };
  }

  private handBack(token: WorkToken, reason: string): WorkGateDecision {
    token.status = 'returned';
    token.returnReason = reason;
    return { ok: false, handedBack: true, token, reason };
  }
}
