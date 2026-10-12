/**
 * Model gateway — the single guarded door to a model (whitepaper §3.10, §5.2).
 *
 * The gateway owns retry policy, token accounting and capability adaptation, so
 * these tests pin exactly that: transient failures are retried with backoff,
 * permanent ones are not, and a provider that cannot call tools gets the tool
 * schemas stripped rather than a broken request.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { ModelCallError, ModelGateway, backoffMs, parseToolArguments } from '../src/model/ModelGateway.js';
import { ScriptedLLM, makeHarness } from './helpers/context.js';

describe('parseToolArguments', () => {
  it('passes an object through unchanged', () => {
    expect(parseToolArguments({ a: 1 })).toEqual({ a: 1 });
  });

  it('parses a JSON string', () => {
    expect(parseToolArguments('{"path":"a.ts"}')).toEqual({ path: 'a.ts' });
  });

  it('treats an empty string as an empty object', () => {
    expect(parseToolArguments('   ')).toEqual({});
  });

  it('surfaces malformed JSON so the schema validator can reject it', () => {
    expect(parseToolArguments('not json')).toEqual({ __raw: 'not json' });
  });
});

describe('backoffMs', () => {
  it('grows exponentially from the base', () => {
    expect(backoffMs(1)).toBe(200);
    expect(backoffMs(2)).toBe(400);
    expect(backoffMs(4)).toBe(1600);
  });
});

describe('ModelGateway.call', () => {
  it('returns text, usage and the attempt count on success', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ text: 'hello', usage: { promptTokens: 10, completionTokens: 5 } }]) });
    const result = await new ModelGateway(h.ctx).call({ purpose: 'execute', system: 'sys', messages: [] });
    expect(result.text).toBe('hello');
    expect(result.attempts).toBe(1);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(result.toolsSuppressed).toBe(false);
  });

  it('prepends the system prompt to the message list', async () => {
    const llm = new ScriptedLLM([{ text: 'x' }]);
    const h = makeHarness({ llm });
    await new ModelGateway(h.ctx).call({ purpose: 'plan', system: 'SYS', messages: [{ role: 'user', content: 'hi' }] });
    expect(llm.requests[0]!.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(llm.requests[0]!.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('accumulates cumulative usage across calls', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ text: 'a', usage: { promptTokens: 3, completionTokens: 2 } }]) });
    const gateway = new ModelGateway(h.ctx);
    await gateway.call({ purpose: 'execute', system: 's', messages: [] });
    await gateway.call({ purpose: 'execute', system: 's', messages: [] });
    expect(gateway.usage.calls).toBe(2);
    expect(gateway.usage.promptTokens).toBe(6);
  });

  it('strips tools when the provider cannot call them', async () => {
    const llm = new ScriptedLLM([{ text: 'x' }], { supportsTools: false });
    const h = makeHarness({ llm });
    const result = await new ModelGateway(h.ctx).call({
      purpose: 'execute',
      system: 's',
      messages: [],
      tools: [{ name: 'fs.read', description: 'd', parameters: { type: 'object' } }],
    });
    expect(result.toolsSuppressed).toBe(true);
    expect(llm.requests[0]!.tools).toBeUndefined();
  });

  it('retries a transient failure and then succeeds', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ error: 'ETIMEDOUT' }, { text: 'recovered' }]) });
    const result = await new ModelGateway(h.ctx).call({ purpose: 'execute', system: 's', messages: [] });
    expect(result.text).toBe('recovered');
    expect(result.attempts).toBe(2);
    expect(h.metrics.query('model.errors')).toHaveLength(1);
  });

  it('uses the decision model when the named cheap model is not installed', async () => {
    const llm = new ScriptedLLM([
      { error: "HTTP 404 from ollama: model 'missing:3b' not found" },
      { text: 'from decision' },
    ]);
    const h = makeHarness({ llm });
    h.ctx.model = 'decision';
    h.ctx.gruntModel = 'missing:3b';
    const result = await new ModelGateway(h.ctx).call({
      purpose: 'execute',
      model: 'missing:3b',
      system: 's',
      messages: [],
    });
    expect(result.text).toBe('from decision');
    expect(llm.requests[1]?.model).toBe('decision');
  });

  it('skips a cheap model on later calls after one not-found response', async () => {
    const llm = new ScriptedLLM([
      { error: "HTTP 404 from ollama: model 'missing:3b' not found" },
      { text: 'first' },
      { text: 'second' },
    ]);
    const h = makeHarness({ llm });
    h.ctx.model = 'decision';
    const gateway = new ModelGateway(h.ctx);
    const first = await gateway.call({ purpose: 'execute', model: 'missing:3b', system: 's', messages: [] });
    const second = await gateway.call({ purpose: 'execute', model: 'missing:3b', system: 's', messages: [] });
    expect(first.text).toBe('first');
    expect(second.text).toBe('second');
    expect(llm.requests.map((request) => request.model)).toEqual(['missing:3b', 'decision', 'decision']);
  });

  it('does not retry a permanent failure and marks it non-retryable', async () => {
    const llm = new ScriptedLLM([{ error: 'malformed plan JSON' }]);
    const h = makeHarness({ llm, config: { maxRetries: 1 } });
    await expect(new ModelGateway(h.ctx).call({ purpose: 'plan', system: 's', messages: [] })).rejects.toMatchObject({
      name: 'ModelCallError',
      retryable: false,
    });
  });

  it('gives up after the retry budget and reports the attempt count', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ error: '503 temporarily unavailable' }]), config: { maxRetries: 3 } });
    let error: ModelCallError | undefined;
    try {
      await new ModelGateway(h.ctx).call({ purpose: 'execute', system: 's', messages: [] });
    } catch (e) {
      error = e as ModelCallError;
    }
    expect(error).toBeInstanceOf(ModelCallError);
    expect(error?.attempts).toBe(3);
    expect(error?.retryable).toBe(true);
  });

  it('emits a debug log for each streamed text delta', async () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ text: 'streamed' }]) });
    await new ModelGateway(h.ctx).call({ purpose: 'execute', system: 's', messages: [] });
    expect(h.events.some((e) => e.type === 'log')).toBe(true);
  });

  it('exposes provider capabilities', () => {
    const h = makeHarness({ llm: new ScriptedLLM([{ text: 'x' }], { quality: 0.4 }) });
    expect(new ModelGateway(h.ctx).capabilities().quality).toBe(0.4);
  });
});

describe('ModelGateway — routing by purpose', () => {
  /**
   * Routing is only observable when the two models differ, so every case here
   * sets `gruntModel` to something distinct — a single-model run is exactly the
   * case where routing must collapse to one name.
   */
  function harness(model: string, gruntModel: string): {
    ctx: ReturnType<typeof makeHarness>['ctx'];
    llm: ScriptedLLM;
  } {
    const llm = new ScriptedLLM([{ text: 'ok' }]);
    const h = makeHarness({ llm });
    h.ctx.model = model;
    h.ctx.gruntModel = gruntModel;
    return { ctx: h.ctx, llm };
  }

  /** Models actually requested, in order. */
  async function modelsUsed(purpose: string, model?: string): Promise<string[]> {
    const { ctx, llm } = harness('big', 'small');
    await new ModelGateway(ctx).call({
      purpose,
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      ...(model ? { model } : {}),
    });
    return llm.requests.map((r) => r.model);
  }

  it('sends planning to the decision model', async () => {
    // Getting the plan wrong costs every downstream step, so this never goes cheap.
    expect(await modelsUsed('plan')).toEqual(['big']);
  });

  it('sends replanning to the decision model', async () => {
    expect(await modelsUsed('replan')).toEqual(['big']);
  });

  it('sends clarification to the grunt model', async () => {
    // Restating a request is mechanical; a weak model does it acceptably.
    expect(await modelsUsed('clarify')).toEqual(['small']);
  });

  it('keeps execution on the decision model', async () => {
    // Tool-call formatting is the fragile part on a weak model (measured: qwen
    // needs the text-call protocol), so a weaker model would make it worse.
    expect(await modelsUsed('execute')).toEqual(['big']);
  });

  it('honours an explicit model on the call', async () => {
    // The caller knows something the heuristic does not.
    expect(await modelsUsed('clarify', 'pinned')).toEqual(['pinned']);
  });

  it('collapses to one model when decision and grunt are the same', async () => {
    // Reporting two models when there is one would imply a distinction that does
    // not exist in the trace.
    const { ctx, llm } = harness('only', 'only');
    await new ModelGateway(ctx).call({ purpose: 'clarify', system: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(llm.requests.map((r) => r.model)).toEqual(['only']);
  });

  it('falls back to the decision model when no grunt model is configured', async () => {
    const { ctx, llm } = harness('only', '');
    await new ModelGateway(ctx).call({ purpose: 'clarify', system: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(llm.requests.map((r) => r.model)).toEqual(['only']);
  });

  it('sends an unknown purpose to the decision model', async () => {
    // Fail safe: a purpose nobody has classified is decision-grade by default.
    expect(await modelsUsed('something-new')).toEqual(['big']);
  });
});
