/**
 * Step executor — one bounded ReAct loop per step (whitepaper §3.3).
 *
 * The executor's job is to *always resolve*: every failure (unknown tool, denial,
 * loop, timeout, abort) is reported inside the `StepResult` so the loop can decide
 * what to do next. These tests pin each of those exits.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { JsonValue } from '@camelia/core';

import { ApprovalGate } from '../src/approval/ApprovalGate.js';
import { WorkspaceJournal } from '../src/checkpoint/WorkspaceJournal.js';
import { ContextManager, emptySlots } from '../src/context/ContextManager.js';
import { Executor, artifactsFrom } from '../src/execution/Executor.js';
import { ModelGateway } from '../src/model/ModelGateway.js';
import { LoopDetector } from '../src/reliability/LoopDetector.js';
import { ToolEngine } from '../src/tools/ToolEngine.js';
import { builtinTools } from '../src/tools/builtin/index.js';
import { ScriptedLLM, makeHarness, makeStep, type Harness, type ScriptedTurn, type TurnSource } from './helpers/context.js';

function compose(h: Harness, source: TurnSource, options: { responder?: (r: unknown) => Promise<boolean>; config?: Partial<Harness['ctx']['config']> } = {}) {
  if (options.config) h.ctx.config = { ...h.ctx.config, ...options.config };
  h.llm; // the harness already holds the llm; caller passes the source via makeHarness
  const gateway = new ModelGateway(h.ctx);
  const tools = new ToolEngine(undefined, h.metrics);
  tools.registerAll(builtinTools);
  const approval = new ApprovalGate(h.ctx.config.approval, options.responder as never, h.logger, h.metrics);
  const context = new ContextManager(h.ctx.config, emptySlots(), undefined, h.logger, h.metrics);
  const journal = new WorkspaceJournal('C:/backups', h.ctx.taskId, h.fs, h.logger);
  const loop = new LoopDetector(h.ctx.config.loopRepeatThreshold);
  const executor = new Executor({ gateway, tools, approval, context, journal, loop, config: h.ctx.config }, h.ctx);
  void source;
  return { executor, context, journal, tools };
}

function harnessWith(source: TurnSource, options: Parameters<typeof makeHarness>[0] = {}): Harness {
  return makeHarness({ ...options, llm: new ScriptedLLM(source) });
}

const writeTurn: ScriptedTurn = {
  toolCalls: [{ name: 'fs.write', arguments: { path: 'a.ts', content: 'export const x = 1;\n' } }],
};

describe('Executor.execute', () => {
  it('runs a tool call and records an artifact', async () => {
    const h = harnessWith([writeTurn, { text: 'Wrote a.ts with the constant.' }]);
    const { executor } = compose(h, []);
    const result = await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    expect(result.status).toBe('ok');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe('ok');
    expect(result.artifacts.some((a) => a.kind === 'file' && a.path === 'a.ts')).toBe(true);
    expect(await h.fs.exists('C:/workspace/a.ts')).toBe(true);
    expect(h.store.toolCalls.size).toBe(1);
  });

  it('reports an unknown tool as a tool-call error without throwing', async () => {
    const h = harnessWith([{ toolCalls: [{ name: 'nope.tool', arguments: {} }] }, { text: '' }]);
    const { executor } = compose(h, []);
    const result = await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    expect(result.toolCalls[0]!.status).toBe('error');
    expect(result.toolCalls[0]!.error).toContain('Unknown tool');
  });

  it('reports a denied tool call and feeds the reason back to the model', async () => {
    const h = harnessWith([{ toolCalls: [{ name: 'shell.exec', arguments: { command: 'ls' } }] }, { text: '' }]);
    h.ctx.config = { ...h.ctx.config, approval: { ...h.ctx.config.approval, byRisk: { ...h.ctx.config.approval.byRisk, privileged: 'deny' } } };
    const { executor } = compose(h, []);
    const result = await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    expect(result.toolCalls[0]!.status).toBe('denied');
    expect(h.events.some((e) => e.type === 'tool.denied')).toBe(true);
  });

  it('approves a privileged call when a responder allows it', async () => {
    const h = harnessWith([{ toolCalls: [{ name: 'shell.exec', arguments: { command: 'npm test' } }] }, { text: 'ran tests' }]);
    const { executor } = compose(h, [], { responder: async () => true });
    const result = await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });    expect(result.toolCalls[0]!.status).toBe('ok');
    expect(h.shell.commands[0]!.command).toBe('npm test');
  });

  it('announces tool.approval_required before the consent answer, so a UI can render the gate', async () => {
    const h = harnessWith([{ toolCalls: [{ name: 'shell.exec', arguments: { command: 'npm test' } }] }, { text: 'ran tests' }]);
    const { executor } = compose(h, [], { responder: async () => true });
    await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    const gateIdx = h.events.findIndex((e) => e.type === 'tool.approval_required');
    const approvedIdx = h.events.findIndex((e) => e.type === 'tool.approved');
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeLessThan(approvedIdx);
    const gate = h.events[gateIdx] as { payload: { call: { id: string; name: string } } };
    expect(gate.payload.call.name).toBe('shell.exec');
  });

  it('does not announce an approval gate for an auto-approved write', async () => {
    const h = harnessWith([writeTurn, { text: 'Wrote a.ts.' }]);
    const { executor } = compose(h, []);
    await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    expect(h.events.some((e) => e.type === 'tool.approval_required')).toBe(false);
  });

  it('breaks the step when the same action repeats past the threshold', async () => {
    const repeated: ScriptedTurn = { toolCalls: [{ name: 'fs.read', arguments: { path: 'a.ts' } }] };
    const h = harnessWith([{ toolCalls: [repeated.toolCalls![0]!, repeated.toolCalls![0]!, repeated.toolCalls![0]!] }, { text: '' }]);
    const { executor } = compose(h, []);
    const result = await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    expect(result.status).toBe('error');
    expect(result.error).toContain('identical arguments');
    expect(h.events.some((e) => e.type === 'reliability.loop_detected')).toBe(true);
  });

  it('aborts immediately when the run signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harnessWith([writeTurn], { signal: controller.signal });
    const { executor } = compose(h, []);
    const result = await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    expect(result.status).toBe('error');
    expect(result.error).toBe('cancelled');
  });

  it('fails the step when the iteration budget is exhausted', async () => {
    const h = harnessWith(() => ({ toolCalls: [{ name: 'fs.read', arguments: { path: 'missing.ts' } }] }));
    h.ctx.config = { ...h.ctx.config, maxIterationsPerStep: 2 };
    const { executor } = compose(h, []);
    const result = await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    expect(result.status).toBe('error');
    expect(result.error).toContain('exceeded 2 model iterations');
  });

  it('strips tool schemas when the provider cannot call tools', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ text: 'I would write a.ts' }], { supportsTools: false }) });
    const { executor } = compose(h, []);
    await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    expect(h.llm.requests[0]!.tools).toBeUndefined();
    expect(h.llm.requests[0]!.messages[0]!.content).toContain('Tool calling is unavailable');
  });

  it('uses the fixup prompt when re-executing after a verification failure', async () => {
    const h = harnessWith([{ text: 'fixed' }]);
    const { executor } = compose(h, []);
    await executor.execute(makeStep({ idx: 0 }), {
      stepIndex: 1,
      stepTotal: 1,
      completedSummaries: [],
      fixupFailures: ['FAIL file-exists: a.ts does not exist'],
    });
    expect(h.llm.requests[0]!.messages[0]!.content).toContain('FAILED verification');
  });
});

describe('artifactsFrom', () => {
  it('derives a file artifact from a write', () => {
    const artifacts = artifactsFrom('fs.write', { path: 'a.ts', content: 'x' }, { path: 'a.ts', bytes: 1, hash: 'h' } as unknown as JsonValue);
    expect(artifacts[0]).toMatchObject({ kind: 'file', path: 'a.ts', hash: 'h' });
  });

  it('derives a stdout artifact from a shell command', () => {
    const artifacts = artifactsFrom('shell.exec', { command: 'ls' }, { stdout: 'a\nb' } as unknown as JsonValue);
    expect(artifacts[0]!.kind).toBe('stdout');
  });

  it('returns nothing for a non-object output', () => {
    expect(artifactsFrom('fs.read', {}, 'plain' as unknown as JsonValue)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Iteration 20: three-layer tool knowledge — on-demand usage injection
// ---------------------------------------------------------------------------

describe('Executor — usage layer injection', () => {
  it('injects the usage doc when the model forgets the syntax, then the corrected call succeeds', async () => {
    // Function-form script: while the model has NOT seen the usage doc it calls
    // fs.read with a missing `path` (schema failure); once the doc is in the
    // system message it calls correctly, then it finishes. This is the
    // "模型忘语法 → 注入用法 → 正确调用" end-to-end path.
    let modelCalls = 0;
    const source: TurnSource = (request) => {
      modelCalls += 1;
      const system = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => String(m.content))
        .join('\n');
      if (modelCalls >= 3) return { text: 'done' };
      if (system.includes('[tool usage — fs.read]')) {
        return { toolCalls: [{ name: 'fs.read', arguments: { path: 'a.ts' } }] };
      }
      return { toolCalls: [{ name: 'fs.read', arguments: {} }] };
    };
    const h = harnessWith(source, { seed: { 'C:/workspace/a.ts': 'export const x = 1;\n' } });
    const { executor } = compose(h, []);

    const result = await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });

    expect(result.status).toBe('ok');
    // The first (wrong) call failed; the corrected one succeeded.
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]!.status).toBe('error');
    expect(result.toolCalls[1]!.status).toBe('ok');
    expect(h.events.some((e) => e.type === 'tool.usage_injected')).toBe(true);
    const injected = h.events.find((e) => e.type === 'tool.usage_injected');
    expect((injected!.payload as { name: string }).name).toBe('fs.read');
  });

  it('injects a tool usage at most once per step', async () => {
    // The model keeps making the same mistake: usage must not be re-injected.
    const h = harnessWith(
      () => ({ toolCalls: [{ name: 'fs.read', arguments: {} }] }),
      { seed: { 'C:/workspace/a.ts': 'x' } },
    );
    h.ctx.config = { ...h.ctx.config, maxIterationsPerStep: 4 };
    const { executor } = compose(h, []);
    await executor.execute(makeStep({ idx: 0 }), { stepIndex: 1, stepTotal: 1, completedSummaries: [] });
    const injections = h.events.filter((e) => e.type === 'tool.usage_injected');
    expect(injections.length).toBe(1);
  });
});