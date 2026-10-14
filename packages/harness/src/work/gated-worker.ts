/**
 * One sub-AI turn that cannot touch a tool unless it holds an active work token.
 * @module
 */

import { newId, type Artifact, type JsonValue, type LLMMessage, type LLMPort, type LLMToolSchema, type SubAgentReport, type Verdict } from '@camelia/core';

import type { SubAgentSpec } from '../subagent/SubAgentOrchestrator.js';
import { parseToolArguments } from '../model/ModelGateway.js';
import { collectLLMTurn } from './collect.js';
import { type WorkToken, type WorkTokenGate } from './WorkTokenGate.js';

const MAX_WORKER_TURNS = 4;

export interface WorkTokenNotice {
  tokenId: string;
  holderId: string;
  status: 'issued' | 'returned' | 'denied';
  reason?: string;
}

export interface GatedWorkerInput {
  spec: SubAgentSpec;
  token: WorkToken | undefined;
  gate: WorkTokenGate;
  memory: string;
  model: string;
  llm: LLMPort;
  /** Schemas already filtered to the token allowlist. */
  tools: LLMToolSchema[];
  /** Called only after `gate.authorize` returns ok. */
  invoke: (name: string, args: JsonValue) => Promise<string>;
  parentTaskId: string;
  now: () => number;
  signal: AbortSignal;
  onToken?: (notice: WorkTokenNotice) => void;
}

export async function runTokenGatedWorker(input: GatedWorkerInput): Promise<SubAgentReport> {
  const startedAt = input.now();
  const blank = {
    parentTaskId: input.parentTaskId,
    goal: input.spec.goal,
    artifacts: [] as Artifact[],
    verdicts: [] as Verdict[],
    tokensUsed: 0,
    startedAt,
  };
  const token = input.token;
  if (!token || token.status !== 'active') {
    return {
      ...blank,
      id: newId(),
      status: 'error',
      summary: 'handed back: no token — tools are refused',
      endedAt: input.now(),
    };
  }

  const thought = token.thought;
  const system = [
    'You are a Camelia sub-AI. You already thought. Stay inside that plan.',
    `Goal: ${thought.goals.join(' | ')}`,
    thought.constraints.length ? `Constraints: ${thought.constraints.join(' | ')}` : '',
    `Plan: ${thought.plan.join(' | ')}`,
    input.memory ? `Shared memory:\n${input.memory}` : '',
    'Call a tool only when a plan step needs it. If the assignment leaves those bounds, reply HANDBACK and do not call a tool.',
  ]
    .filter(Boolean)
    .join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: input.spec.goal },
  ];
  let text = '';
  for (let turn = 0; turn < MAX_WORKER_TURNS; turn += 1) {
    if (input.signal.aborted) break;
    const collected = await collectLLMTurn(
      input.llm,
      { model: input.model, messages, tools: input.tools, temperature: 0 },
      input.signal,
    );
    text = collected.text;
    if (collected.calls.length === 0) {
      return {
        ...blank,
        id: newId(),
        status: 'ok',
        summary: text.trim() || 'done',
        endedAt: input.now(),
      };
    }
    messages.push({ role: 'assistant', content: text, toolCalls: collected.calls });
    for (const call of collected.calls) {
      const args = parseToolArguments(call.arguments);
      const decision = input.gate.authorize(token.id, call.name, args);
      if (!decision.ok) {
        input.onToken?.({
          tokenId: token.id,
          holderId: token.holderId,
          status: decision.handedBack ? 'returned' : 'denied',
          reason: decision.reason,
        });
        return {
          ...blank,
          id: newId(),
          status: 'error',
          summary: `handed back: ${decision.reason}`,
          endedAt: input.now(),
        };
      }
      let feedback: string;
      try {
        feedback = await input.invoke(call.name, args);
      } catch (error) {
        feedback = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
      messages.push({ role: 'tool', name: call.name, toolCallId: call.id, content: feedback });
    }
  }
  return {
    ...blank,
    id: newId(),
    status: 'error',
    summary: text.trim() || 'handed back: worker stopped without a summary',
    endedAt: input.now(),
  };
}
