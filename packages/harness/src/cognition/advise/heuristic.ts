/**
 * External heuristic table (YAML or JSON) with a required version.
 *
 * The parser accepts the shipped shape only: a version string and a list of
 * rules. A malformed table is a failed parse, not a silent empty rule.
 * @module
 */

import {
  ADVISE_ACTION_IDS,
  ADVISE_ERROR_CLASSES,
  type AdviseActionId,
  type AdviseErrorClass,
  type EnvironmentStatus,
} from '@camelia/core';

export interface HeuristicRule {
  readonly id: string;
  readonly errorClass: AdviseErrorClass;
  readonly environment?: EnvironmentStatus;
  readonly candidates: readonly AdviseActionId[];
  readonly priority: number;
  readonly enabled: boolean;
}

export interface HeuristicTable {
  readonly heuristic_table_version: string;
  readonly rules: readonly HeuristicRule[];
}

export type ParseTableResult = { ok: true; table: HeuristicTable } | { ok: false; reason: string };

const ACTIONS = new Set<string>(ADVISE_ACTION_IDS);
const CLASSES = new Set<string>(ADVISE_ERROR_CLASSES);
const ENVIRONMENTS = new Set<string>(['OK', 'FAIL', 'UNKNOWN']);

export function parseHeuristicTable(text: string): ParseTableResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  const raw = trimmed.startsWith('{') ? parseJson(trimmed) : parseSimpleYaml(trimmed);
  if (!raw.ok) return raw;
  return coerceTable(raw.value);
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: 'json' };
  }
}

function coerceTable(value: unknown): ParseTableResult {
  if (!isRecord(value)) return { ok: false, reason: 'table' };
  const version = value.heuristic_table_version;
  if (typeof version !== 'string' || !version.trim()) return { ok: false, reason: 'version' };
  if (!Array.isArray(value.rules)) return { ok: false, reason: 'rules' };
  const rules: HeuristicRule[] = [];
  for (const entry of value.rules) {
    const rule = coerceRule(entry);
    if (!rule.ok) return rule;
    rules.push(rule.rule);
  }
  return { ok: true, table: { heuristic_table_version: version, rules } };
}

function coerceRule(value: unknown): { ok: true; rule: HeuristicRule } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: 'rule' };
  if (typeof value.id !== 'string' || !value.id.trim()) return { ok: false, reason: 'rule.id' };
  if (typeof value.errorClass !== 'string' || !CLASSES.has(value.errorClass)) return { ok: false, reason: 'rule.errorClass' };
  if (!Array.isArray(value.candidates) || value.candidates.length === 0) return { ok: false, reason: 'rule.candidates' };
  const candidates: AdviseActionId[] = [];
  for (const candidate of value.candidates) {
    if (typeof candidate !== 'string' || !ACTIONS.has(candidate)) return { ok: false, reason: 'rule.candidates' };
    candidates.push(candidate as AdviseActionId);
  }
  if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) return { ok: false, reason: 'rule.priority' };
  if (typeof value.enabled !== 'boolean') return { ok: false, reason: 'rule.enabled' };
  let environment: EnvironmentStatus | undefined;
  if (value.environment !== undefined) {
    if (typeof value.environment !== 'string' || !ENVIRONMENTS.has(value.environment)) return { ok: false, reason: 'rule.environment' };
    environment = value.environment as EnvironmentStatus;
  }
  return {
    ok: true,
    rule: {
      id: value.id,
      errorClass: value.errorClass as AdviseErrorClass,
      ...(environment ? { environment } : {}),
      candidates,
      priority: value.priority,
      enabled: value.enabled,
    },
  };
}

function parseSimpleYaml(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const root: Record<string, unknown> = {};
  let rules: Record<string, unknown>[] | null = null;
  let current: Record<string, unknown> | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const body = line.trim();
    if (indent === 0 && body === 'rules:') {
      rules = [];
      root.rules = rules;
      current = null;
      continue;
    }
    if (rules && body.startsWith('- ')) {
      current = {};
      rules.push(current);
      const rest = body.slice(2).trim();
      if (rest && !assign(current, rest)) return { ok: false, reason: 'yaml' };
      continue;
    }
    if (rules && current && indent > 0) {
      if (!assign(current, body)) return { ok: false, reason: 'yaml' };
      continue;
    }
    if (indent === 0) {
      if (!assign(root, body)) return { ok: false, reason: 'yaml' };
      continue;
    }
    return { ok: false, reason: 'yaml' };
  }
  return { ok: true, value: root };
}

function assign(target: Record<string, unknown>, body: string): boolean {
  const split = splitKv(body);
  if (!split) return false;
  target[split.key] = split.value;
  return true;
}

function splitKv(body: string): { key: string; value: unknown } | undefined {
  const index = body.indexOf(':');
  if (index <= 0) return undefined;
  return { key: body.slice(0, index).trim(), value: parseScalar(body.slice(index + 1).trim()) };
}

function parseScalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '') return null;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseScalar(part.trim()));
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
