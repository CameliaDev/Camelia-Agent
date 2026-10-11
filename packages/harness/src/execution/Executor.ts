/**
 * Step executor (whitepaper §3.3).
 *
 * Runs exactly one `Step` as a bounded ReAct loop: the model proposes tool calls,
 * each call passes through loop detection, the approval gate and the tool engine,
 * and the result is fed back as a tool message. The loop is hard-capped by
 * `maxIterationsPerStep` and `maxToolCallsPerStep` so no step can run away.
 * @module
 */

import type {
  Artifact,
  JsonValue,
  LLMToolCall,
  Step,
  StepResult,
  ToolCall,
} from '@camelia/core';
import { newId } from '@camelia/core';

import type { ApprovalGate } from '../approval/ApprovalGate.js';
import type { WorkspaceJournal } from '../checkpoint/WorkspaceJournal.js';
import type { ContextManager } from '../context/ContextManager.js';
import type { RunContext } from '../context/RunContext.js';
import { runMeta } from '../context/RunContext.js';
import type { HarnessConfig } from '../config.js';
import { ModelGateway, parseToolArguments } from '../model/ModelGateway.js';
import { recoverTextToolCalls, stripTextToolCalls } from '../model/text-tool-calls.js';
import { executorSystemPrompt, fixupSystemPrompt } from '../prompts/system.js';
import type { LoopDetector } from '../reliability/LoopDetector.js';
import type { ToolContext, ToolResult } from '../tools/types.js';
import type { ToolEngine } from '../tools/ToolEngine.js';

export interface ExecutorDeps {
  gateway: ModelGateway;
  tools: ToolEngine;
  approval: ApprovalGate;
  context: ContextManager;
  journal: WorkspaceJournal;
  loop: LoopDetector;
  config: HarnessConfig;
}

export interface ExecuteOptions {
  stepIndex: number;
  stepTotal: number;
  completedSummaries: string[];
  /** Present when re-executing a step that failed verification. */
  fixupFailures?: string[];
  /** Attempt override. Absent keeps the purpose router. */
  model?: string;
  /** Attempt 2 appends a longer reflection before the model acts. */
  reflect?: boolean;
}

export class Executor {
  constructor(
    private readonly deps: ExecutorDeps,
    private readonly ctx: RunContext,
  ) {}

  /**
   * Execute one step. Always resolves: failures are reported inside `StepResult`
   * so the loop can decide whether to retry, replan or roll back.
   */
  async execute(step: Step, options: ExecuteOptions): Promise<StepResult> {
    const meta = runMeta(this.ctx);
    const startedAt = this.ctx.ports.clock.now();
    const toolCalls: ToolCall[] = [];
    const artifacts: Artifact[] = [];
    // Usage-layer docs injected this step, per tool — a tool's usage is injected at
    // most once so a stubborn model cannot balloon the context (Iteration 20).
    const injectedUsage = new Set<string>();
    let summary = '';
    let error: string | undefined;
    let iterations = 0;

    const caps = this.deps.gateway.capabilities();
    const toolsAvailable = caps.supportsTools;
    // Resolved before the prompt is built: the prompt needs the real tool names
    // so the model cannot invent one (measured: it emitted a `fs.mkdir` that
    // does not exist when asked to create a directory).
    const schemas = toolsAvailable ? this.deps.tools.schemas(this.ctx.allowedTools) : undefined;

    const basePrompt = options.fixupFailures?.length
      ? fixupSystemPrompt(step, options.fixupFailures, options.reflect === true)
      : executorSystemPrompt({
          step,
          stepIndex: options.stepIndex,
          stepTotal: options.stepTotal,
          completedSummaries: options.completedSummaries,
          toolsAvailable,
          toolNames: schemas?.map((schema) => schema.name),
          textToolCalls: caps.textToolCalls === true,
          directives: this.ctx.presetDirectives,
        });
    const baseSystem = options.reflect
      ? `${basePrompt}\n\nBefore the next tool call, restate the failure, the file you will change, and the check that must pass. Then act.`
      : basePrompt;

    this.ctx.infra.bus.emit('step.started', { step }, meta);
    const span = this.ctx.infra.tracer.startSpan('step.execute', {
      traceId: this.ctx.traceId,
      attributes: { stepId: step.id, idx: step.idx, title: step.title },
    });

    while (iterations < this.deps.config.maxIterationsPerStep) {
      iterations += 1;
      this.ctx.infra.metrics.inc('loop.iterations', { step: String(step.idx) });

      if (this.ctx.signal.aborted) {
        error = 'cancelled';
        break;
      }

      // Keep the window healthy before every model call.
      if (this.deps.context.shouldCompact()) {
        await this.compact('soft-limit');
      }

      // Context exhaustion (Iteration 24, failure mode wiring): when usage has
      // reached the hard window even after soft compaction, record the mechanism
      // so the next plan for this workspace can read it. The run continues — a
      // pinned-heavy context may still be usable — but the failure is on record.
      if (this.deps.context.tokenUsage() >= this.deps.config.contextWindow) {
        await this.ctx.infra.store.recordFailureMode({
          kind: 'context-exhaustion',
          mechanism: 'executor: context usage reached the window before a model call (ContextManager.tokenUsage >= config.contextWindow)',
          workspace: this.ctx.workspace,
        });
      }

      const built = this.deps.context.build(baseSystem);
      const system = built.messages[0]?.content ?? baseSystem;
      const conversation = built.messages.slice(1);

      let response;
      try {
        response = await this.deps.gateway.call({
          purpose: 'execute',
          model: options.model,
          system,
          messages: conversation,
          tools: schemas,
          maxTokens: 4_000,
        });
      } catch (callError) {
        error = callError instanceof Error ? callError.message : String(callError);
        break;
      }

      const assistantText = response.text.trim();

      // Text-embedded tool calls.
      //
      // Some models (measured: `qwen2.5-coder:7b` on Ollama 0.40.2) understand
      // the offered tools perfectly but describe the call as text instead of
      // using the structured channel. Without this, `response.toolCalls` is
      // empty, the loop below breaks on "the model considers the step finished",
      // and the task silently accomplishes nothing while still reporting
      // progress — the worst failure shape there is.
      //
      // Gated on `schemas` having been offered AND the provider returning no
      // structured calls: a real function-calling provider stays authoritative
      // over its own output and is never second-guessed.
      const recovered =
        schemas && response.toolCalls.length === 0
          ? recoverTextToolCalls(assistantText, schemas)
          : [];

      if (recovered.length > 0) {
        this.ctx.infra.logger.info('recovered tool call from model text', {
          stepId: step.id,
          tools: recovered.map((call) => call.name),
        });
        response = { ...response, toolCalls: recovered };
        // The user should read narration, not machine-readable call syntax.
        summary = stripTextToolCalls(assistantText) || summary;
      } else if (assistantText) {
        summary = assistantText;
      }

      this.deps.context.append({
        role: 'assistant',
        content: recovered.length > 0 ? stripTextToolCalls(assistantText) : assistantText,
        toolCalls: response.toolCalls.length ? response.toolCalls : undefined,
      });

      if (response.toolCalls.length === 0) {
        // No tools requested: the model considers the step finished.
        break;
      }

      let loopBroken = false;
      for (const call of response.toolCalls) {
        if (toolCalls.length >= this.deps.config.maxToolCallsPerStep) {
          this.ctx.infra.logger.warn('tool-call budget exhausted for step', { stepId: step.id });
          loopBroken = true;
          break;
        }

        const outcome = await this.runToolCall(step, call, artifacts, injectedUsage);
        toolCalls.push(outcome.record);
        this.deps.context.append({
          role: 'tool',
          name: call.name,
          toolCallId: call.id,
          content: outcome.feedback,
        });

        if (outcome.loopDetected) {
          loopBroken = true;
          error = outcome.feedback;
          break;
        }
      }
      if (loopBroken) break;
    }

    if (iterations >= this.deps.config.maxIterationsPerStep && !error) {
      error = `Step exceeded ${this.deps.config.maxIterationsPerStep} model iterations without finishing.`;
      this.ctx.infra.bus.emit('reliability.no_progress', {
        streak: iterations,
        action: 'step-aborted',
      }, meta);
    }

    const durationMs = this.ctx.ports.clock.now() - startedAt;
    this.ctx.infra.tracer.end(span, error ? 'error' : 'ok', { iterations, toolCalls: toolCalls.length });
    this.ctx.infra.metrics.observe('exec.step_duration_ms', durationMs, { step: String(step.idx) });
    this.ctx.infra.metrics.observe('exec.tool_calls_per_step', toolCalls.length, { step: String(step.idx) });

    const result: StepResult = {
      stepId: step.id,
      status: error ? 'error' : 'ok',
      toolCalls,
      summary: summary || (error ? `Step failed: ${error}` : 'Step completed with no summary.'),
      artifacts,
      error,
    };

    // Persist the step summary so later steps and the final report can see it.
    this.deps.context.append({
      role: 'system',
      content: `[step ${options.stepIndex} ${error ? 'failed' : 'done'}] ${result.summary}`,
    });
    for (const artifact of artifacts) this.deps.context.addArtifact(artifact.path);

    return result;
  }

  /** Run one tool call through loop detection, approval and the tool engine. */
  private async runToolCall(
    step: Step,
    call: LLMToolCall,
    artifacts: Artifact[],
    injectedUsage: Set<string>,
  ): Promise<{ record: ToolCall; feedback: string; loopDetected: boolean }> {
    const meta = runMeta(this.ctx);
    const input = parseToolArguments(call.arguments);
    const tool = this.deps.tools.get(call.name);

    const record: ToolCall = {
      id: newId(),
      stepId: step.id,
      taskId: this.ctx.taskId,
      name: call.name,
      input,
      status: 'pending',
      risk: tool?.risk ?? 'privileged',
      reversible: tool?.reversible ?? false,
      traceId: this.ctx.traceId,
      createdAt: this.ctx.ports.clock.now(),
    };

    // 1. Loop detection before anything has a side effect.
    const loopSignal = this.deps.loop.recordAction(call.name, input);
    if (loopSignal.detected) {
      this.ctx.infra.bus.emit('reliability.loop_detected', {
        fingerprint: loopSignal.fingerprint,
        repeats: loopSignal.repeats,
        action: 'break-step',
      }, meta);
      record.status = 'error';
      record.error = loopSignal.message;
      await this.persist(record);
      return {
        record,
        feedback: `BLOCKED: ${loopSignal.message} Do not repeat this call — change your approach or stop and report what is blocking you.`,
        loopDetected: true,
      };
    }

    this.ctx.infra.bus.emit('tool.requested', { call: record }, meta);
    if (!tool) {
      record.status = 'error';
      record.error = `Unknown tool "${call.name}".`;
      await this.persist(record);
      return { record, feedback: record.error, loopDetected: false };
    }

    // 2. Preset allowlist — a tool the active preset excludes must not run, even if
    //    the model asked for it. Checked before approval so an excluded tool is a
    //    hard "no", not a prompt the user has to answer (§8.3).
    const allowed = this.ctx.allowedTools;
    if (allowed && !allowed.includes('*') && !allowed.includes(call.name)) {
      record.status = 'error';
      record.error = `Tool "${call.name}" is not permitted by the active agent preset.`;
      await this.persist(record);
      this.ctx.infra.bus.emit('tool.failed', {
        callId: record.id,
        name: call.name,
        error: record.error,
        recoverable: false,
      }, meta);
      return {
        record,
        feedback: `BLOCKED: ${record.error} Use only the tools offered to you.`,
        loopDetected: false,
      };
    }

    // 3. Approval gate.
    const candidate = {
      callId: record.id,
      name: call.name,
      risk: record.risk,
      input,
      approval: tool.approval,
    };
    // Announce the gate *before* awaiting consent: the UI must be able to render the
    // approval prompt while the run is suspended, not after it has already resumed.
    if (this.deps.approval.needsApproval(candidate)) {
      this.ctx.infra.bus.emit('tool.approval_required', { call: record }, meta);
    }
    const decision = await this.deps.approval.decide(candidate);
    if (!decision.allowed) {
      this.ctx.infra.bus.emit('tool.denied', { callId: record.id, reason: decision.reason }, meta);
      record.status = 'denied';
      record.error = decision.reason;
      await this.persist(record);
      return {
        record,
        feedback: `DENIED (${decision.by}): ${decision.reason}. Choose a different approach that stays within policy.`,
        loopDetected: false,
      };
    }
    record.status = 'approved';
    this.ctx.infra.bus.emit('tool.approved', { callId: record.id, by: decision.by }, meta);
    this.ctx.infra.bus.emit('tool.started', { callId: record.id, name: call.name }, meta);

    // 3. Execute under a per-tool timeout.
    record.status = 'running';
    const invocation = await this.withTimeout(
      this.deps.tools.invoke(call.name, input, this.toolContext()),
      this.deps.config.toolTimeoutMs,
    );

    if (invocation.ok) {
      record.status = 'ok';
      record.output = invocation.output;
      record.durationMs = invocation.durationMs;
      artifacts.push(...artifactsFrom(call.name, input, invocation.output));
      this.ctx.infra.bus.emit('tool.finished', { call: record }, meta);
      await this.persist(record);
      return { record, feedback: stringifyOutput(invocation.output), loopDetected: false };
    }

    record.status = 'error';
    record.error = invocation.error;
    record.durationMs = invocation.durationMs;
    this.ctx.infra.bus.emit('tool.failed', {
      callId: record.id,
      name: call.name,
      error: invocation.error,
      recoverable: invocation.retryable,
    }, meta);
    await this.persist(record);
    // Usage layer — the model forgot the syntax: inject this tool's usage doc
    // (exactly once per step) so the next iteration can call it correctly.
    if (!injectedUsage.has(call.name)) {
      const usage = this.deps.tools.usageOf(call.name);
      if (usage) {
        injectedUsage.add(call.name);
        this.deps.context.append({
          role: 'system',
          content: `[tool usage — ${call.name}]\n${usage}`,
        }, { pinned: true });
        this.ctx.infra.bus.emit('tool.usage_injected', { name: call.name, chars: usage.length }, meta);
        this.ctx.infra.logger.info('injected tool usage after failure', { tool: call.name });
      }
    }
    return {
      record,
      feedback: `ERROR from ${call.name}: ${invocation.error}${
        invocation.retryable ? ' (transient — you may retry once with corrected arguments)' : ''
      }`,
      loopDetected: false,
    };
  }

  private toolContext(): ToolContext {
    return {
      workspace: this.ctx.workspace,
      fs: this.ctx.ports.fs,
      shell: this.ctx.ports.shell,
      search: this.ctx.ports.search,
      logger: this.ctx.infra.logger,
      clock: this.ctx.ports.clock,
      journal: this.deps.journal,
      signal: this.ctx.signal,
    };
  }

  private async persist(record: ToolCall): Promise<void> {
    try {
      await this.ctx.infra.store.insertToolCall(record);
      await this.ctx.infra.store.updateToolCall(record.id, {
        output: record.output,
        status: record.status,
        durationMs: record.durationMs,
        error: record.error,
      });
    } catch (error) {
      this.ctx.infra.logger.warn('failed to persist tool call', {
        toolCallId: record.id,
        error: String(error),
      });
    }
  }

  private async compact(reason: 'soft-limit' | 'hard-limit'): Promise<void> {
    const meta = runMeta(this.ctx);
    const before = this.deps.context.tokenUsage();
    this.ctx.infra.bus.emit('context.compaction_started', { tokensBefore: before, reason }, meta);
    const result = await this.deps.context.compact(reason);
    if (!result.performed) return;
    this.ctx.infra.bus.emit('context.compacted', {
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      droppedMessages: result.dropped,
      summaries: result.summaries,
      droppedPreviews: result.droppedPreviews,
      protectedSlots: protectedSlotNames(this.deps.context),
    }, meta);
  }

  /** Race an operation against a timeout so a hung tool cannot stall the run. */
  private async withTimeout(operation: Promise<ToolResult>, timeoutMs: number): Promise<ToolResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = this.ctx.ports.clock.now();
    const timeout = new Promise<ToolResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          ok: false,
          error: `Tool timed out after ${timeoutMs}ms`,
          retryable: true,
          durationMs: this.ctx.ports.clock.now() - startedAt,
        });
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Derive artifacts from a tool's output — this is what the verifier and report use. */
export function artifactsFrom(name: string, input: JsonValue, output: JsonValue): Artifact[] {
  const artifacts: Artifact[] = [];
  const out = output as Record<string, unknown> | null;
  if (!out || typeof out !== 'object') return artifacts;

  if ((name === 'fs.write' || name === 'fs.edit') && typeof out.path === 'string') {
    artifacts.push({
      kind: 'file',
      path: out.path,
      hash: typeof out.hash === 'string' ? out.hash : undefined,
      sizeBytes: typeof out.bytes === 'number' ? out.bytes : undefined,
    });
  }
  if (name === 'shell.exec' || name === 'test.run') {
    const command = String((input as { command?: unknown })?.command ?? '');
    artifacts.push({
      kind: 'stdout',
      path: `${name}:${command}`.slice(0, 120),
      sizeBytes: typeof out.stdout === 'string' ? out.stdout.length : undefined,
    });
  }
  return artifacts;
}

function protectedSlotNames(context: ContextManager): string[] {
  const slots = context.protectedSlots;
  const names: string[] = [];
  if (slots.goal) names.push('goal');
  if (slots.constraints.length) names.push('constraints');
  if (slots.todos.length) names.push('todos');
  if (slots.artifacts.length) names.push('artifacts');
  return names;
}

/** Compact a tool output for the model, capping very large payloads. */
function stringifyOutput(output: JsonValue): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  if (text.length <= 8_000) return text;
  return `${text.slice(0, 6_000)}\n... [${text.length - 8_000} chars truncated] ...\n${text.slice(-2_000)}`;
}