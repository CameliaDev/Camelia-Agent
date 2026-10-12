/**
 * Planner, clarifier and the prompt contracts that encode engine behaviour.
 *
 * The planner treats model output as untrusted: whatever it emits is coerced into
 * a usable plan, and an unusable plan falls back to a deterministic single step
 * (whitepaper §3.2). The clarifier never asks a question — it records assumptions.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { ModelGateway } from '../src/model/ModelGateway.js';
import { Clarifier } from '../src/planning/Clarifier.js';
import { Planner } from '../src/planning/Planner.js';
import {
  clarifySystemPrompt,
  executorSystemPrompt,
  fixupSystemPrompt,
  granularityFor,
  plannerSystemPrompt,
} from '../src/prompts/system.js';
import { workspaceDigest, workspaceSummary } from '../src/context/workspace-summary.js';
import { ScriptedLLM, makeHarness, makeIntent, makeStep } from './helpers/context.js';

function plannerFor(text: string, caps = {}) {
  const llm = new ScriptedLLM([{ text }], caps);
  const h = makeHarness({ llm });
  const planner = new Planner(new ModelGateway(h.ctx), h.ctx);
  return { planner, h };
}

describe('Planner.plan', () => {
  it('turns model JSON into an ordered plan', async () => {
    const text = JSON.stringify({
      steps: [
        { title: 'Write file', goal: 'create CONTRIBUTING.md', acceptance: [{ kind: 'file-exists', params: { path: 'CONTRIBUTING.md' } }] },
        { title: 'Document', goal: 'add usage section', deps: [0], acceptance: [{ kind: 'file-contains', params: { path: 'CONTRIBUTING.md', pattern: 'Usage' } }] },
      ],
    });
    const { planner, h } = plannerFor(text);
    const plan = await planner.plan(makeIntent(), { workspaceSummaryOverride: 'CONTRIBUTING.md' });
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1]!.deps).toEqual([plan.steps[0]!.id]);
    expect(h.events.some((e) => e.type === 'plan.ready')).toBe(true);
    expect(h.metrics.query('plan.step_count')).toHaveLength(1);
  });

  it('falls back to a single step when the model emits nothing usable', async () => {
    const { planner, h } = plannerFor('I cannot help with that.');
    const plan = await planner.plan(makeIntent({ expectedPaths: ['a.ts'] }), { workspaceSummaryOverride: 'a.ts' });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.acceptance[0]!.kind).toBe('file-exists');
    expect(h.logger.lines.some((l) => l.level === 'warn')).toBe(true);
  });

  it('falls back when the model call fails outright', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ error: 'malformed plan JSON' }]), config: { maxRetries: 1 } });
    const planner = new Planner(new ModelGateway(h.ctx), h.ctx);
    const plan = await planner.plan(makeIntent(), { workspaceSummaryOverride: 'x' });
    expect(plan.steps).toHaveLength(1);
    expect(h.events.some((e) => e.type === 'plan.failed')).toBe(true);
  });

  it('picks fast mode for a trivial task and full mode otherwise', async () => {
    const text = JSON.stringify({ steps: [{ title: 'One', goal: 'g' }] });
    const { planner } = plannerFor(text);
    const fast = await planner.plan(makeIntent({ goal: 'fix typo', expectedPaths: ['a.ts'] }), { workspaceSummaryOverride: 'a.ts' });
    expect(fast.mode).toBe('fast');

    const { planner: planner2 } = plannerFor(text);
    const full = await planner2.plan(
      makeIntent({ goal: 'implement a cross-module feature spanning many files and concerns', expectedPaths: ['a.ts', 'b.ts'] }),
      { workspaceSummaryOverride: 'a.ts b.ts' },
    );
    expect(full.mode).toBe('full');
  });

  it('exposes provider capabilities', () => {
    const { planner } = plannerFor('{}');
    expect(planner.capabilities().supportsTools).toBe(true);
  });

  it('rejects an off-list path and replans onto the allowed list', async () => {
    const bad = JSON.stringify({
      steps: [{ title: 'Write', goal: 'g', acceptance: [{ kind: 'file-exists', params: { path: 'nope.ts' } }] }],
    });
    const good = JSON.stringify({
      steps: [{ title: 'Write', goal: 'g', acceptance: [{ kind: 'file-exists', params: { path: 'a.ts' } }] }],
    });
    const llm = new ScriptedLLM([{ text: bad }, { text: good }]);
    const h = makeHarness({ llm });
    const planner = new Planner(new ModelGateway(h.ctx), h.ctx);
    const plan = await planner.plan(makeIntent({ expectedPaths: ['a.ts'] }));
    expect(plan.steps[0]!.acceptance[0]!.params.path).toBe('a.ts');
    expect(llm.requests).toHaveLength(2);
  });

  it('fails with the rejected path after the replan is still off-list', async () => {
    const bad = JSON.stringify({
      steps: [{ title: 'Write', goal: 'g', acceptance: [{ kind: 'file-exists', params: { path: 'nope.ts' } }] }],
    });
    const { planner } = plannerFor(bad);
    await expect(planner.plan(makeIntent({ expectedPaths: ['a.ts'] }))).rejects.toThrow(/nope\.ts/);
  });
});

describe('Planner.revise', () => {
  it('produces a revised plan and bumps the revision', async () => {
    const initial = JSON.stringify({ steps: [{ title: 'A', goal: 'g' }] });
    const revised = JSON.stringify({ steps: [{ title: 'A2', goal: 'g2' }, { title: 'B', goal: 'g3' }] });
    const llm = new ScriptedLLM([{ text: initial }, { text: revised }]);
    const h = makeHarness({ llm });
    const planner = new Planner(new ModelGateway(h.ctx), h.ctx);
    const plan = await planner.plan(makeIntent(), { workspaceSummaryOverride: 'x' });
    const next = await planner.revise(plan, { reason: 'step failed', previousTitles: ['A'] }, makeIntent());
    expect(next.steps).toHaveLength(2);
    expect(next.revision).toBe(1);
    expect(h.events.some((e) => e.type === 'plan.revised')).toBe(true);
  });

  it('keeps the previous plan when the revision is unusable', async () => {
    const initial = JSON.stringify({ steps: [{ title: 'A', goal: 'g' }] });
    const llm = new ScriptedLLM([{ text: initial }, { text: 'no json here' }]);
    const h = makeHarness({ llm });
    const planner = new Planner(new ModelGateway(h.ctx), h.ctx);
    const plan = await planner.plan(makeIntent(), { workspaceSummaryOverride: 'x' });
    const next = await planner.revise(plan, { reason: 'r', previousTitles: [] }, makeIntent());
    expect(next).toBe(plan);
  });

  it('keeps the previous plan when the revision call throws', async () => {
    const initial = JSON.stringify({ steps: [{ title: 'A', goal: 'g' }] });
    const llm = new ScriptedLLM((_req, i) => (i === 0 ? { text: initial } : { error: 'malformed JSON' }));
    const h = makeHarness({ llm, config: { maxRetries: 1 } });
    const planner = new Planner(new ModelGateway(h.ctx), h.ctx);
    const plan = await planner.plan(makeIntent(), { workspaceSummaryOverride: 'x' });
    const next = await planner.revise(plan, { reason: 'r', previousTitles: [] }, makeIntent());
    expect(next).toBe(plan);
  });
});

describe('Clarifier', () => {
  it('parses a structured intent from the model', async () => {
    const text = JSON.stringify({
      goal: 'Add a CONTRIBUTING guide',
      assumptions: ['Markdown is fine'],
      constraints: ['do not touch tests'],
      expectedPaths: ['CONTRIBUTING.md'],
      complete: true,
    });
    const h = makeHarness({ llm: new ScriptedLLM([{ text }]) });
    const intent = await new Clarifier(new ModelGateway(h.ctx), h.ctx).clarify('add contributing docs', {
      workspaceSummaryOverride: 'CONTRIBUTING.md',
    });
    expect(intent.goal).toBe('Add a CONTRIBUTING guide');
    expect(intent.constraints).toEqual(['do not touch tests']);
    expect(intent.complete).toBe(true);
  });

  it('uses the workspace listing, not the path set the model invented', async () => {
    const text = JSON.stringify({ goal: 'g', expectedPaths: ['src\\invented.ts'] });
    const h = makeHarness({ llm: new ScriptedLLM([{ text }]), seed: { 'C:/workspace/README.md': '# hi' } });
    const intent = await new Clarifier(new ModelGateway(h.ctx), h.ctx).clarify('edit the readme', { workspaceSummaryOverride: 's' });
    expect(intent.expectedPaths).toEqual(['README.md']);
  });

  it('uses the deterministic listing in offline mode', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/README.md': '# hi' } });
    const intent = await new Clarifier(new ModelGateway(h.ctx), h.ctx).clarify('edit src/a.ts and README.md', { offline: true });
    expect(intent.goal).toBe('edit src/a.ts and README.md');
    expect(intent.expectedPaths).toEqual(['README.md']);
    expect(intent.complete).toBe(true);
  });

  it('uses the fallback when the provider cannot emit JSON', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ text: '{}' }], { supportsJson: false }) });
    const intent = await new Clarifier(new ModelGateway(h.ctx), h.ctx).clarify('do a thing');
    expect(intent.goal).toBe('do a thing');
  });

  it('uses the fallback when the model returns unusable JSON', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ text: 'sorry, no.' }]) });
    const intent = await new Clarifier(new ModelGateway(h.ctx), h.ctx).clarify('do a thing', { workspaceSummaryOverride: 's' });
    expect(intent.goal).toBe('do a thing');
  });

  it('uses the fallback when the model call throws', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ error: 'malformed JSON' }]), config: { maxRetries: 1 } });
    const intent = await new Clarifier(new ModelGateway(h.ctx), h.ctx).clarify('do a thing', { workspaceSummaryOverride: 's' });
    expect(intent.goal).toBe('do a thing');
  });
});

describe('granularityFor — architecture compensates for model strength', () => {
  const caps = (quality: number, supportsTools = true) => ({
    supportsTools,
    supportsJson: true,
    supportsStreaming: true,
    maxContextWindow: 128_000,
    quality,
  });

  it('splits into many small steps for a weak or tool-less model', () => {
    const weak = granularityFor(caps(0.3), 24);
    expect(weak.maxSteps).toBe(12);
    expect(weak.guidance).toContain('small');
    const noTools = granularityFor(caps(0.9, false), 24);
    expect(noTools.maxSteps).toBe(12);
  });

  it('uses a moderate cap for a mid-tier model', () => {
    expect(granularityFor(caps(0.6), 24).maxSteps).toBe(16);
  });

  it('lets a strong model use the full budget', () => {
    expect(granularityFor(caps(0.9), 24).maxSteps).toBe(24);
  });

  it('inverts the guidance for a model that writes tool calls as text', () => {
    // The subtle one. Quality 0.4 would normally mean "many small steps", but
    // a text-tool model pays an extra fragile round trip per step, so more steps
    // means more chances to fail. Measured: told to prefer many small steps,
    // qwen2.5-coder:7b split "write hello.txt" into "Create directory 'src'" +
    // "Create file" + "Write text" — and the first step needed a tool that does
    // not exist. With the cap inverted it emits a single verifiable step.
    const profile = granularityFor({ ...caps(0.4), textToolCalls: true }, 24);
    expect(profile.maxSteps).toBe(6);
    expect(profile.guidance).toContain('fewest steps');
  });

  it('applies the text-tool cap even for a high-quality model', () => {
    // Capability beats quality here: the round-trip cost is structural.
    expect(granularityFor({ ...caps(0.95), textToolCalls: true }, 24).maxSteps).toBe(6);
  });

  it('leaves a capable model on the normal track', () => {
    expect(granularityFor({ ...caps(0.4), textToolCalls: false }, 24).maxSteps).toBe(12);
  });
});

describe('prompt builders', () => {
  it('planner prompt states the goal, constraints and step cap', () => {
    const prompt = plannerSystemPrompt({
      intent: makeIntent({ goal: 'ship it', constraints: ['no new deps'], assumptions: ['ts'] }),
      workspaceSummary: 'a.ts',
      granularity: { maxSteps: 5, guidance: 'be small' },
    });
    expect(prompt).toContain('ship it');
    expect(prompt).toContain('no new deps');
    expect(prompt).toContain('Emit at most 5 steps');
    expect(prompt).toContain('a.ts');
  });

  it('planner prompt records revision context', () => {
    const prompt = plannerSystemPrompt({
      intent: makeIntent(),
      workspaceSummary: '',
      granularity: { maxSteps: 5, guidance: '' },
      revision: { reason: 'step failed', previousTitles: ['A', 'B'] },
    });
    expect(prompt).toContain('REVISION');
    expect(prompt).toContain('A | B');
  });

  it('executor prompt lists acceptance points and completed work', () => {
    const step = makeStep({
      idx: 0,
      title: 'Write it',
      goal: 'create file',
      acceptance: [{ id: 'a1', description: 'file exists', kind: 'file-exists', params: { path: 'a.ts' } }],
    });
    const prompt = executorSystemPrompt({ step, stepIndex: 1, stepTotal: 3, completedSummaries: ['did x'], toolsAvailable: true });
    expect(prompt).toContain('Step 1/3: Write it');
    expect(prompt).toContain('[file-exists] file exists');
    expect(prompt).toContain('did x');
  });

  it('executor prompt warns when tools are unavailable', () => {
    const prompt = executorSystemPrompt({ step: makeStep({ idx: 0 }), stepIndex: 1, stepTotal: 1, completedSummaries: [], toolsAvailable: false });
    expect(prompt).toContain('Tool calling is unavailable');
  });

  it('executor prompt names the real tools so the model cannot invent one', () => {
    // Regression guard. Measured: qwen2.5-coder:7b emitted `fs.mkdir` — which
    // does not exist — when asked to create a directory, even though `fs.write`
    // already creates parent directories. The capability existed; only the name
    // was wrong, and the engine rejected it.
    const prompt = executorSystemPrompt({
      step: makeStep({ idx: 0 }),
      stepIndex: 1,
      stepTotal: 1,
      completedSummaries: [],
      toolsAvailable: true,
      toolNames: ['fs.read', 'fs.write'],
    });
    expect(prompt).toContain('fs.read, fs.write');
    expect(prompt).toContain('There is no other tool');
  });

  it('executor prompt omits the tool list when none were offered', () => {
    const prompt = executorSystemPrompt({
      step: makeStep({ idx: 0 }),
      stepIndex: 1,
      stepTotal: 1,
      completedSummaries: [],
      toolsAvailable: true,
      toolNames: [],
    });
    expect(prompt).not.toContain('There is no other tool');
  });

  it('executor prompt gives the exact format when the endpoint lacks a tool channel', () => {
    // Without the format the model writes prose, the step ends having done
    // nothing, and the failure surfaces as "file does not exist".
    const prompt = executorSystemPrompt({
      step: makeStep({ idx: 0 }),
      stepIndex: 1,
      stepTotal: 1,
      completedSummaries: [],
      toolsAvailable: true,
      toolNames: ['fs.write'],
      textToolCalls: true,
    });
    expect(prompt).toContain('does not support the structured tool-call channel');
    expect(prompt).toContain('{"name": "<tool name from the list above>", "arguments": { ... }}');
    expect(prompt).toContain('A name you invent is discarded');
  });

  it('executor prompt stays silent about the text format on a normal endpoint', () => {
    // A provider with a real function-calling channel must not be told to
    // hand-write JSON; doing so would degrade a working provider.
    const prompt = executorSystemPrompt({
      step: makeStep({ idx: 0 }),
      stepIndex: 1,
      stepTotal: 1,
      completedSummaries: [],
      toolsAvailable: true,
      toolNames: ['fs.write'],
    });
    expect(prompt).not.toContain('structured tool-call channel');
  });

  it('clarify prompt embeds the raw request and listing', () => {
    const prompt = clarifySystemPrompt({ rawIntent: 'do x', workspaceSummary: 'a.ts' });
    expect(prompt).toContain('do x');
    expect(prompt).toContain('a.ts');
  });

  it('fixup prompt lists the verification failures', () => {
    const prompt = fixupSystemPrompt(makeStep({ idx: 0, title: 'S' }), ['FAIL file-exists: missing']);
    expect(prompt).toContain('FAIL file-exists: missing');
  });

  it('fixup prompt keeps steps that already finished', () => {
    const prompt = fixupSystemPrompt(makeStep({ idx: 1, title: 'Run check' }), ['FAIL command-exit-zero: exited 1'], false, [
      'Write a.txt',
    ]);
    expect(prompt).toContain('Completed so far:');
    expect(prompt).toContain('Write a.txt');
  });
});

describe('workspaceSummary', () => {
  it('lists files and reports when the workspace is empty', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/src/a.ts': 'a' } });
    const summary = await workspaceSummary(h.ctx.ports.fs, h.ctx.workspace, {});
    expect(summary).toContain('src/a.ts');
  });

  it('degrades gracefully when listing throws', async () => {
    const broken = { list: async () => { throw new Error('nope'); } } as never;
    expect(await workspaceSummary(broken, 'C:/workspace')).toBe('(workspace listing unavailable)');
  });

  it('returns a placeholder for an empty workspace', async () => {
    const h = makeHarness();
    expect(await workspaceSummary(h.ctx.ports.fs, h.ctx.workspace)).toBe('(workspace is empty)');
  });

  it('workspaceDigest is order-independent', () => {
    expect(workspaceDigest(['b', 'a'])).toBe(workspaceDigest(['a', 'b']));
  });
});
describe('planner prompt — executor capability', () => {
  it('lists the tools the executor will have', () => {
    // Regression guard for a measured failure: the planner emitted
    // "Create directory 'src'" for a task that only needed a file written,
    // because no tool was named and it assumed a mkdir existed.
    const prompt = plannerSystemPrompt({
      intent: makeIntent({ goal: 'write hello.txt' }),
      workspaceSummary: '',
      granularity: { maxSteps: 6, guidance: 'g' },
      toolNames: ['fs.read', 'fs.write'],
    });
    expect(prompt).toContain('Tools the executor will have');
    expect(prompt).toContain('fs.read');
    expect(prompt).toContain('fs.write');
    expect(prompt).toContain('never plan a separate directory-creation step');
  });

  it('omits the tool section when none are known', () => {
    const prompt = plannerSystemPrompt({
      intent: makeIntent({ goal: 'ship it' }),
      workspaceSummary: '',
      granularity: { maxSteps: 6, guidance: 'g' },
    });
    expect(prompt).not.toContain('Tools the executor will have');
  });
});

describe('planner prompt — path fidelity', () => {
  it('forbids inventing a directory prefix', () => {
    // Measured: asked for `a.js`, qwen produced `src/a.js` and the verifier
    // correctly failed against the acceptance. The model treats a project-shaped
    // prefix as good manners; the rule has to be spelled out.
    const prompt = plannerSystemPrompt({
      intent: makeIntent({ goal: 'create a.js' }),
      workspaceSummary: '',
      granularity: { maxSteps: 6, guidance: 'g' },
    });
    expect(prompt).toContain('use exactly the path the user named');
    expect(prompt).toContain('never add a directory prefix');
  });
});
