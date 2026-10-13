/**
 * Built-in agent presets (whitepaper §8.3).
 *
 * A preset is a persona: prompt + tool allowlist + model preference. The three
 * here cover the common shapes of work, and each one's allowlist is a real safety
 * property, not decoration — `reviewer` and `researcher` cannot write, so a run
 * under those presets cannot mutate the workspace even if the model asks to.
 *
 * `modelPreference` is intentionally empty on the built-ins: a model id that only
 * exists on one provider would break on the others. Users set it in
 * `~/.camelia/presets/*.json` where they know which models their keys reach.
 * @module
 */

import type { AgentPreset } from '@camelia/core';

/** Workspace-read tools shared by the two non-mutating presets. */
const WORKSPACE_READ_TOOLS = ['fs.read', 'fs.list', 'search.glob', 'search.grep', 'test.run', 'shell.exec'];

export const builtinPresets: AgentPreset[] = [
  {
    id: 'coder',
    label: 'Coder',
    description: 'Default: full tool access, plans before acting.',
    systemPrompt:
      'You are a careful coding agent. Read a file before you edit it. Prefer the smallest diff that satisfies the goal. ' +
      'After changing code, run the relevant test or build command and report what it printed. Never claim success you did not observe.',
    allowedTools: ['*'],
    plannerMode: 'full',
    modelPreference: {},
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    description: 'Read-only: finds defects, never edits.',
    systemPrompt:
      'You are a code reviewer. You never modify files — you have no write tools and must not ask for them. ' +
      'Find concrete defects and back every claim with a file path, a line, or a command output. ' +
      'Rank findings by severity and state explicitly when you find nothing wrong.',
    allowedTools: WORKSPACE_READ_TOOLS,
    plannerMode: 'fast',
    modelPreference: {},
  },
  {
    id: 'researcher',
    label: 'Researcher',
    description: 'Read-only: answers questions about the codebase (and the web) with evidence.',
    systemPrompt:
      'You are a codebase researcher. You never modify files. Answer only from what you have read, run, or fetched via web_search. ' +
      'When the evidence is insufficient, say what is missing instead of guessing. Cite paths, commands, and URLs for every conclusion.',
    allowedTools: [...WORKSPACE_READ_TOOLS, 'web_search'],
    plannerMode: 'fast',
    modelPreference: {},
  },
];

/** The preset used when none is named. */
export const DEFAULT_PRESET_ID = 'coder';
