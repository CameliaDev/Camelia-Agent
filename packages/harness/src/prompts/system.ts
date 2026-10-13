/**
 * System prompts for the planning and execution stages.
 *
 * Prompts live in the harness (not the agent layer) because they encode *engine
 * behaviour* — how a step is bounded, what counts as evidence, how a weak model
 * is compensated for (whitepaper §5.1, §5.2).
 * @module
 */

import type { ProviderCapabilities } from '@camelia/core';
import type { ClarifiedIntent, Step } from '@camelia/core';
import { localNowPromptLine } from '@camelia/core';
import type { ProjectProfile } from '../profile/project-profile.js';
import { looksLikeMathModeling, MATH_MODELING_STEP_TEMPLATE } from './math-modeling.js';
import { matchModels } from './math-models.js';

/** Granularity guidance derived from provider capability (whitepaper §5.2). */
export interface GranularityProfile {
  /** Upper bound on steps the planner may emit. */
  maxSteps: number;
  /** Target size of one step. */
  guidance: string;
}

/**
 * Weak models get more, smaller steps so each one is verifiable in isolation;
 * strong models get fewer, larger steps to save round trips.
 */
export function granularityFor(caps: ProviderCapabilities, maxSteps: number): GranularityProfile {
  // A model that must write its tool calls as text has a shorter, more fragile
  // turn: every step costs it an extra round trip and one more chance to
  // malform a call. Splitting the work into more steps therefore *raises* the
  // chance of failure rather than lowering it — measured: told to prefer many
  // small steps, qwen2.5-coder:7b split "write hello.txt" into "Create directory
  // 'src'" + "Create file" + "Write text", and the first step needed a tool that
  // does not exist.
  //
  // So for this class of model the guidance is inverted: fewest steps that still
  // verify something. Capability, not just quality, decides the shape.
  if (caps.textToolCalls) {
    return {
      maxSteps: Math.min(maxSteps, 6),
      guidance:
        'Use the fewest steps possible — ideally ONE. Each extra step is another chance to fail. Combine related actions into a single step as long as it can be verified.',
    };
  }
  if (!caps.supportsTools || caps.quality < 0.5) {
    return {
      maxSteps: Math.min(maxSteps, 12),
      guidance:
        'Prefer many small, single-purpose steps. Each step must touch at most one file or run at most one command. Do not combine unrelated changes.',
    };
  }
  if (caps.quality < 0.75) {
    return {
      maxSteps: Math.min(maxSteps, 16),
      guidance: 'Keep steps focused on one concern each; split any step that needs more than three tool calls.',
    };
  }
  return {
    maxSteps,
    guidance: 'Cohesive steps are fine; aim for the smallest set of steps that fully delivers the goal.',
  };
}

export interface PlannerPromptOptions {
  intent: ClarifiedIntent;
  /** Workspace file listing, already truncated by the caller. */
  workspaceSummary: string;
  granularity: GranularityProfile;
  /** When set, the planner is revising rather than planning from scratch. */
  revision?: { reason: string; previousTitles: string[] };
  /**
   * Names of the tools the executor will have, so the plan only contains steps
   * those tools can actually accomplish.
   */
  toolNames?: readonly string[];
  /** Persona directives from the active agent preset (whitepaper §8.3). */
  directives?: string;
  /**
   * Project profile loaded for this workspace (Iteration 24). Its conventions /
   * pitfalls / verification / forbidden rules are injected so the plan does not
   * repeat the project's recorded mistakes.
   */
  profile?: ProjectProfile;
}

export function plannerSystemPrompt(options: PlannerPromptOptions): string {
  const { intent, workspaceSummary, granularity, revision, toolNames = [], directives, profile } = options;
  const lines: string[] = [
    'You are the PLANNER of Camelia, a task-completion-first coding agent.',
    'You do not write code. You decompose the goal into an ordered, verifiable plan.',
    '用中文填写所有自然语言字段（title、goal、acceptance.description）。JSON 键名、工具名、文件路径、kind 值保持英文原样。',
    localNowPromptLine(),
    '',
    'Rules:',
    '1. Every step must be independently verifiable. Attach machine-checkable acceptance points.',
    '2. Acceptance kinds allowed: file-exists | file-contains | command-exit-zero | test-pass | diff-nonempty | manual.',
    '3. Acceptance params must be concrete: e.g. {"path":"src/a.ts"} or {"path":"src/a.ts","pattern":"export function foo"} or {"command":"npm run build"}. For file-contains, "pattern" is the literal text the file must contain — do not escape it as a regular expression.',
    '4. Use "deps" as 0-based indices of steps that must complete first. Keep the graph acyclic.',
    '5. Never invent file paths. Every acceptance path must be one of the allowed paths listed below. An off-list path is rejected.',
    '6. Do not include verification-only steps: verification is automatic after every step.',
    `7. Emit at most ${granularity.maxSteps} steps. ${granularity.guidance}`,
    '',
    'Reply with JSON only — no prose, no markdown fences:',
    '{"steps":[{"title":"short imperative title","goal":"what this step must achieve","deps":[0],"acceptance":[{"description":"why this proves it","kind":"file-exists","params":{"path":"src/a.ts"}}]}]}',
    '',
    `Goal: ${intent.goal}`,
  ];
  if (intent.constraints.length) lines.push(`Constraints: ${intent.constraints.join(' | ')}`);
  if (intent.assumptions.length) lines.push(`Assumptions already made: ${intent.assumptions.join(' | ')}`);
  if (intent.expectedPaths.length) {
    lines.push(`Allowed paths (enum): ${intent.expectedPaths.join(', ')}`);
  } else {
    lines.push('Allowed paths (enum): (none — do not attach a file path)');
  }

  // The tools the executor will actually have.
  //
  // A weak model plans steps the executor cannot perform: measured,
  // qwen2.5-coder:7b produced "Create directory 'src'" for a task that only
  // needed a file written. Naming the real tools lets the planner see that
  // `fs.write` creates parent directories on its own, so no separate directory
  // step is needed. Prose rule 5 alone does not achieve this — the model has to
  // be shown, not told.
  if (toolNames.length > 0) {
    lines.push(
      '',
      'Tools the executor will have (plan only steps these can accomplish):',
      ...toolNames.map((name) => `  - ${name}`),
      'Note: fs.write creates parent directories automatically — never plan a separate directory-creation step.',
    );
  }

  // Paths must be copied, not improved.
  //
  // Measured: asked for `a.js`, the planner produced `src/a.js` — a directory the
  // user never mentioned, which the verifier then (correctly) failed against. A
  // weak model treats a project-shaped prefix as good manners. Spelling out the
  // copy rule is cheaper than losing a 40-second run to it.
  lines.push(
    '',
    'Path rule: use exactly the path the user named. If the goal says "create a.js", the acceptance must be {"path":"a.js"} — never add a directory prefix like "src/" that the user did not ask for.',
  );

  if (directives) lines.push('', 'Persona directives (from the active agent preset):', directives);
  if (profile) {
    lines.push('', 'Project profile (from ~/.camelia/profiles — obey it):');
    if (profile.name) lines.push(`  name: ${profile.name}`);
    if (profile.conventions.length) {
      lines.push('  conventions:', ...profile.conventions.map((item) => `    - ${item}`));
    }
    if (profile.pitfalls.length) {
      lines.push('  pitfalls (avoid these):', ...profile.pitfalls.map((item) => `    - ${item}`));
    }
    if (profile.verification.length) {
      lines.push('  verification (how this project verifies):', ...profile.verification.map((item) => `    - ${item}`));
    }
    if (profile.forbidden.length) {
      lines.push('  forbidden (never do these):', ...profile.forbidden.map((item) => `    - ${item}`));
    }
  }
  // Math-modeling mode: inject pipeline + matched model suggestions.
  if (looksLikeMathModeling(intent.goal)) {
    const matched = matchModels(intent.goal);
    lines.push(
      '',
      '【数学建模模式】按以下步骤规划（不要跳步）：',
      ...MATH_MODELING_STEP_TEMPLATE.map((s, i) => `  ${i + 1}. ${s}`),
      '',
      '计算必须用 math.exec 工具调用 Python（sympy/numpy/scipy/matplotlib），禁止手算。',
    );
    if (matched.length > 0) {
      lines.push('可能适用的模型：', ...matched.map((m) => `  - ${m.name}: ${m.formulation}`));
    }
  }

  if (workspaceSummary) lines.push('', 'Workspace listing (authoritative — do not invent other paths):', workspaceSummary);
  if (revision) {
    lines.push(
      '',
      `This is a REVISION. Reason: ${revision.reason}`,
      `Previous step titles: ${revision.previousTitles.join(' | ') || '(none)'}`,
      'Produce a corrected plan that addresses the reason. Reuse steps that already succeeded.',
    );
  }
  return lines.join('\n');
}

export interface ExecutorPromptOptions {
  step: Step;
  /** 1-based position, for the model's situational awareness. */
  stepIndex: number;
  stepTotal: number;
  /** Results of already-completed steps, one line each. */
  completedSummaries: string[];
  /** True when the provider cannot call tools — the model must emit text-only. */
  toolsAvailable: boolean;
  /** Names of the tools actually offered, so the model cannot invent one. */
  toolNames?: readonly string[];
  /**
   * True when the endpoint has no structured tool-call channel and calls must
   * be written as text. Adds the exact expected format to the prompt.
   */
  textToolCalls?: boolean;
  /** Persona directives from the active agent preset (whitepaper §8.3). */
  directives?: string;
}

export function executorSystemPrompt(options: ExecutorPromptOptions): string {
  const {
    step,
    stepIndex,
    stepTotal,
    completedSummaries,
    toolsAvailable,
    toolNames = [],
    textToolCalls = false,
    directives,
  } = options;
  const acceptance = step.acceptance
    .map((a) => `  - [${a.kind}] ${a.description} ${JSON.stringify(a.params)}`)
    .join('\n');

  const lines: string[] = [
    'You are the EXECUTOR of Camelia. You complete exactly one step, then stop.',
    '用中文回复所有叙述性内容（总结、说明、错误描述）。工具调用、JSON、文件路径和代码保持英文原样。',
    localNowPromptLine(),
    '',
    `Step ${stepIndex}/${stepTotal}: ${step.title}`,
    `Objective: ${step.goal}`,
    'Acceptance points that will be checked after you stop:',
    acceptance || '  - (none declared; the change itself must be observable)',
    '',
    'Rules:',
    '1. Use the provided tools. Never describe a change you did not make.',
    '2. Read a file before editing it. Never guess file contents.',
    '3. When the acceptance points are satisfied, stop calling tools and reply with a one-paragraph summary of what changed and how you verified it.',
    '4. If you are blocked, stop and say precisely what is missing. Do not loop.',
  ];

  // The available tool names, spelled out.
  //
  // Without this list a model will invent plausible-sounding tools — measured:
  // qwen2.5-coder:7b emitted `fs.mkdir`, which does not exist, when asked to
  // create a directory. `fs.write` already creates parent directories, so the
  // capability was present and only the *name* was wrong. An invented name is
  // rejected by the engine, and the step fails with a message the model cannot
  // act on. Naming the real tools removes that entire failure class.
  if (toolsAvailable && toolNames.length > 0) {
    lines.push('', `Available tools (use these names exactly): ${toolNames.join(', ')}`);
    lines.push('There is no other tool. If what you need is missing, do the closest equivalent with these.');
  }

  if (!toolsAvailable) {
    lines.push(
      '5. Tool calling is unavailable with this model. Output the exact file contents to write, in fenced blocks labelled with the file path, and the commands to run.',
    );
  }

  // When the provider has no function-calling channel, say so *and* give the
  // exact shape the runtime parses. Otherwise the model writes prose and the
  // step ends having done nothing.
  if (toolsAvailable && textToolCalls) {
    lines.push(
      '',
      'This endpoint does not support the structured tool-call channel. To invoke a tool, reply with a single JSON object and nothing else:',
      '{"name": "<tool name from the list above>", "arguments": { ... }}',
      'Rules for this format:',
      '- Exactly one JSON object, no prose before or after, no markdown fence.',
      '- "name" must be copied verbatim from the tool list. A name you invent is discarded.',
      '- After the tool result comes back, continue with the next action the same way.',
    );
  }

  if (completedSummaries.length) {
    lines.push('', 'Completed so far:', ...completedSummaries.map((s) => `  - ${s}`));
  }
  if (directives) lines.push('', 'Persona directives (from the active agent preset):', directives);
  return lines.join('\n');
}

export interface ClarifyPromptOptions {
  rawIntent: string;
  workspaceSummary: string;
}

export function clarifySystemPrompt(options: ClarifyPromptOptions): string {
  return [
    'You are the CLARIFIER of Camelia. Restate the user request as an executable goal.',
    '用中文填写所有自然语言字段（goal、assumptions、constraints）。JSON 键名、文件路径、代码标识符保持英文原样。',
    localNowPromptLine(),
    'Reply with JSON only:',
    '{"goal":"one sentence","assumptions":["..."],"constraints":["..."],"expectedPaths":["src/..."],"complete":true}',
    'Set complete=false only when the request is genuinely impossible to act on without more information.',
    'Do not ask questions in prose — record what you assumed instead.',
    '',
    `Request: ${options.rawIntent}`,
    options.workspaceSummary ? `\nWorkspace listing:\n${options.workspaceSummary}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Prompt used when a step failed verification and we ask for a targeted fix. */
export function fixupSystemPrompt(
  step: Step,
  failures: string[],
  reflect = false,
  completedSummaries: string[] = [],
): string {
  const lines = [
    'You are the EXECUTOR of Camelia, fixing a step that FAILED verification.',
    '用中文回复所有叙述性内容。工具调用、JSON、文件路径和代码保持英文原样。',
    localNowPromptLine(),
    `Step: ${step.title}`,
    `Objective: ${step.goal}`,
    '',
    'Verification failures:',
    ...failures.map((f) => `  - ${f}`),
    '',
    'Address only these failures. Do not restructure unrelated code.',
  ];
  if (completedSummaries.length) {
    lines.push('', 'Completed so far:', ...completedSummaries.map((s) => `  - ${s}`));
  }
  if (reflect) {
    lines.push(
      '',
      'Reflection before you act:',
      '- What exactly failed, in one sentence.',
      '- Which allowed file you will change.',
      '- Which acceptance check must become true.',
      'Then make the change.',
    );
  }
  return lines.join('\n');
}