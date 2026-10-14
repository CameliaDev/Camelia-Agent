/**
 * Situation signatures (ARCH-COGNITION §4.2–§4.3).
 *
 * Archetype comes from deterministic keyword rules. This module does not call
 * a model. The backoff key drops specificity one field at a time; `toolset`
 * is not part of the key (it only helps decide `scope`, and is kept on the
 * prediction for audit).
 * @module
 */

import type { CapabilityClass, ScopeClass, SituationSignature, StepArchetype } from '@camelia/core';

const ARCHETYPE_RULES: readonly { archetype: StepArchetype; pattern: RegExp }[] = [
  { archetype: 'verify', pattern: /\b(verify|verifies|verification|lint|typecheck|assert|tests?)\b|测试|校验|验证/i },
  { archetype: 'research', pattern: /\b(search|grep|research|lookup|find)\b|搜索|查找|调研/i },
  { archetype: 'exec', pattern: /\b(run|exec|execute|shell|build|npm|pnpm|command)\b|运行|执行|命令/i },
  { archetype: 'write', pattern: /\b(create|scaffold|add|write)\b|创建|新建|写入/i },
  { archetype: 'edit', pattern: /\b(edit|update|modify|change|fix|patch|refactor)\b|修改|编辑|修复|更新/i },
  { archetype: 'read', pattern: /\b(read|inspect|open|list|show|review)\b|读取|查看|浏览/i },
];

const TOOL_NAMES = [
  'fs.read',
  'fs.write',
  'fs.edit',
  'fs.list',
  'shell.exec',
  'shell.run',
  'search.grep',
  'search.query',
  'web.search',
] as const;

const PATH_RE = /(?:[\w.-]+\/)*[\w.-]+\.[\w]+/g;

/**
 * First matching rule wins. Verify is ahead of exec so "run the tests" is a
 * check, not a generic command. No match falls through to `read` — the least
 * mutating archetype — rather than inventing a seventh class.
 */
export function inferArchetype(text: string): StepArchetype {
  for (const rule of ARCHETYPE_RULES) {
    if (rule.pattern.test(text)) return rule.archetype;
  }
  return 'read';
}

export function inferToolset(text: string): string[] {
  const found = new Set<string>();
  const haystack = text.toLowerCase();
  for (const name of TOOL_NAMES) {
    if (haystack.includes(name)) found.add(name);
  }
  return [...found].sort();
}

export function pathsInText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.match(PATH_RE) ?? []) found.add(match.replace(/^\.\//, ''));
  return [...found].sort();
}

/**
 * Path count wins when the plan names files. Otherwise toolset length is only
 * a hint: 1 → single-file, 2–3 → few-files, 4+ → many-files. Neither signal
 * means `unknown`.
 */
export function inferScope(pathCount: number, toolsetLength: number): ScopeClass {
  const hinted = pathCount > 0 ? pathCount : toolsetLength >= 4 ? 4 : toolsetLength >= 2 ? 2 : toolsetLength === 1 ? 1 : 0;
  if (hinted <= 0) return 'unknown';
  if (hinted === 1) return 'single-file';
  if (hinted <= 3) return 'few-files';
  return 'many-files';
}

/** `textToolCalls` is its own class even when `supportsTools` is also set. */
export function capabilityClass(
  caps: { supportsTools?: boolean; textToolCalls?: boolean } | undefined,
): CapabilityClass {
  if (caps?.textToolCalls) return 'text-tool-calls';
  if (caps?.supportsTools) return 'tool-calling';
  return 'no-tools';
}

export function inDegreeOf(stepId: string, steps: readonly { id: string; deps: readonly string[] }[]): number {
  let count = 0;
  for (const step of steps) if (step.deps.includes(stepId)) count += 1;
  return count;
}

export function buildSignature(input: {
  title: string;
  goal?: string;
  acceptancePaths?: readonly string[];
  toolset?: readonly string[];
  inDegree?: number;
  capability: CapabilityClass;
}): SituationSignature {
  const text = `${input.title}\n${input.goal ?? ''}`;
  const toolset = [...new Set([...(input.toolset ?? inferToolset(text))])].sort();
  const paths = new Set<string>([...pathsInText(text), ...(input.acceptancePaths ?? [])]);
  return {
    capability: input.capability,
    archetype: inferArchetype(text),
    scope: inferScope(paths.size, toolset.length),
    toolset,
    inDegree: Math.max(0, Math.trunc(input.inDegree ?? 0)),
  };
}

/**
 * Canonical backoff key. Level 3 keeps in-degree; each step down replaces one
 * field with `*`; level −1 is the global key.
 *
 *   L3  "text-tool-calls|edit|few-files|3"
 *   L2  "text-tool-calls|edit|few-files|*"
 *   L1  "text-tool-calls|edit|*|*"
 *   L0  "text-tool-calls|*|*|*"
 *   L-1 "*"
 */
export function signatureKeyAt(signature: SituationSignature, level: number): string {
  if (level <= -1) return '*';
  const cap = signature.capability;
  const arch = level >= 1 ? signature.archetype : '*';
  const scope = level >= 2 ? signature.scope : '*';
  const deg = level >= 3 ? String(Math.max(0, Math.trunc(signature.inDegree))) : '*';
  return `${cap}|${arch}|${scope}|${deg}`;
}

export function backoffChain(signature: SituationSignature): readonly { level: number; key: string }[] {
  return [3, 2, 1, 0, -1].map((level) => ({ level, key: signatureKeyAt(signature, level) }));
}
