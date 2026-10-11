/**
 * Scripted agent provider.
 *
 * A `MockProvider` script that can actually *complete a real file task* — create
 * files, apply edits and run commands — by reacting to the stage marker in the
 * system prompt (CLARIFIER / PLANNER / EXECUTOR) rather than to a fragile call
 * index.
 *
 * This is not a toy (whitepaper §9.3): it is how the whole engine — planning,
 * execution, verification, persistence, events, rollback — is exercised
 * end-to-end with zero model quota. `camelia run --mock` and the e2e acceptance
 * suites both drive this provider.
 * @module
 */

import type { ChatRequest, JsonValue } from '@camelia/core';

import type { ScriptResolver, ScriptedTurn } from './MockProvider.js';

export interface ScriptedEdit {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

export interface ScriptedTaskSpec {
  /** Files to create: workspace-relative path -> exact content. */
  create?: Record<string, string>;
  /** Files to modify in place. */
  edit?: Record<string, ScriptedEdit>;
  /** Commands run as a final, separately verifiable step. */
  commands?: string[];
  /** Appended to every executor summary so the run is self-describing. */
  note?: string;
}

type Stage = 'clarify' | 'plan' | 'execute' | 'fixup' | 'unknown';

function stageOf(system: string): Stage {
  if (system.includes('You are the CLARIFIER')) return 'clarify';
  if (system.includes('You are the PLANNER')) return 'plan';
  if (system.includes('You are the EXECUTOR') && system.includes('FAILED verification')) return 'fixup';
  if (system.includes('You are the EXECUTOR')) return 'execute';
  return 'unknown';
}

/** First user message content — the goal restatement the planner is given. */
function firstUser(request: ChatRequest): string {
  const message = request.messages.find((m) => m.role === 'user');
  return message?.content ?? '';
}

/** Pull a quoted `"path":"..."` acceptance parameter out of the executor prompt. */
function acceptancePath(system: string): string | undefined {
  return system.match(/"path"\s*:\s*"([^"]+)"/)?.[1];
}

/** Pull a quoted `"command":"..."` acceptance parameter out of the executor prompt. */
function acceptanceCommand(system: string): string | undefined {
  return system.match(/"command"\s*:\s*"([^"]+)"/)?.[1];
}

/**
 * Build a deterministic script that plans one step per declared mutation plus one
 * command step, then executes each by emitting the matching tool call.
 */
export function scriptedTaskScript(spec: ScriptedTaskSpec): ScriptResolver {
  const createPaths = Object.keys(spec.create ?? {});
  const editPaths = Object.keys(spec.edit ?? {});
  const targetPaths = [...createPaths, ...editPaths];
  const commands = spec.commands ?? [];
  const callsPerTarget = new Map<string, number>();
  const note = spec.note ? ` ${spec.note}` : '';

  return (request: ChatRequest): ScriptedTurn => {
    const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
    const stage = stageOf(system);

    if (stage === 'clarify') {
      return {
        text: JSON.stringify({
          goal: firstUser(request) || 'Complete the requested change.',
          assumptions: ['The change is applied in place inside the workspace.'],
          constraints: [],
          expectedPaths: targetPaths,
          complete: true,
        }),
        finishReason: 'stop',
      };
    }

    if (stage === 'plan') {
      const steps: JsonValue[] = targetPaths.map((targetPath) => ({
        title: `Apply change to ${targetPath}`,
        goal: `Ensure ${targetPath} exists with the required content.`,
        deps: [],
        acceptance: [
          {
            description: `${targetPath} exists after the change`,
            kind: 'file-exists',
            params: { path: targetPath },
          },
        ],
      }));
      for (const command of commands) {
        steps.push({
          title: `Verify with: ${command}`,
          goal: `Run \`${command}\` and confirm it exits zero.`,
          deps: targetPaths.map((_, index) => index),
          acceptance: [
            {
              description: `\`${command}\` exits zero`,
              kind: 'command-exit-zero',
              params: { command },
            },
          ],
        });
      }
      if (steps.length === 0) {
        steps.push({
          title: 'Confirm the workspace is unchanged',
          goal: 'No mutation was requested; confirm the workspace is intact.',
          deps: [],
          acceptance: [{ description: 'Workspace listed', kind: 'manual', params: {} }],
        });
      }
      return { text: JSON.stringify({ steps }), finishReason: 'stop' };
    }

    if (stage === 'fixup') {
      return {
        text: `Re-applied the requested change and re-checked the acceptance points.${note}`,
        finishReason: 'stop',
      };
    }

    if (stage === 'execute') {
      const targetPath = acceptancePath(system);
      const command = acceptanceCommand(system);
      const key = targetPath ?? command ?? 'unknown';
      const seen = callsPerTarget.get(key) ?? 0;
      callsPerTarget.set(key, seen + 1);

      if (seen > 0) {
        return {
          text: `${targetPath ? `Wrote ${targetPath}` : `Ran \`${command}\``} and confirmed the acceptance point.${note}`,
          finishReason: 'stop',
        };
      }

      if (targetPath) {
        const created = spec.create?.[targetPath];
        if (created !== undefined) {
          return {
            toolCalls: [{ name: 'fs.write', arguments: { path: targetPath, content: created } }],
            finishReason: 'tool_calls',
          };
        }
        const edit = spec.edit?.[targetPath];
        if (edit) {
          return {
            toolCalls: [
              {
                name: 'fs.edit',
                arguments: {
                  path: targetPath,
                  oldText: edit.oldText,
                  newText: edit.newText,
                  replaceAll: edit.replaceAll ?? false,
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }
      }

      if (command) {
        return {
          toolCalls: [{ name: 'shell.exec', arguments: { command } }],
          finishReason: 'tool_calls',
        };
      }

      return { text: 'Nothing to execute for this step.', finishReason: 'stop' };
    }

    return { text: 'Scripted provider received an unrecognised prompt.', finishReason: 'stop' };
  };
}

/**
 * Convenience spec for `camelia run --mock`: write a single self-describing note
 * file and list the workspace so the full pipeline is observable offline.
 */
export function mockDemoSpec(intent: string, targetPath = 'camelia-mock-output.md'): ScriptedTaskSpec {
  const body = [
    '# Camelia mock run',
    '',
    'This file was produced by the scripted provider to exercise the complete',
    'plan → execute → verify → deliver pipeline without a model API key.',
    '',
    `Task: ${intent}`,
    '',
  ].join('\n');
  return { create: { [targetPath]: body }, commands: ['node --version'] };
}