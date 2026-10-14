/**
 * Sub-agent orchestrator (whitepaper §3.6).
 *
 * Isolates a sub-task in its own context window and returns only a *structured,
 * token-capped* report — the parent never absorbs a sub-agent's full transcript.
 * That is the whole point: context isolation is what keeps a long task from
 * drowning in its own history.
 * @module
 */

import type { Artifact, Id, SubAgentReport, Verdict } from '@camelia/core';
import { estimateTokens, newId, shortId } from '@camelia/core';

import type { RunContext } from '../context/RunContext.js';
import { runMeta } from '../context/RunContext.js';
import type { HarnessConfig } from '../config.js';

export interface SubAgentSpec {
  goal: string;
  /** Workspace-relative paths the sub-agent may focus on. */
  focusPaths?: string[];
  /** Hard cap on wall-clock time for the sub-agent. */
  timeoutMs?: number;
  /** Model id for this worker. The parent decision model is used when omitted. */
  model?: string;
  /** Role label from the coordinator (researcher, writer, …). */
  role?: string;
}

/** Implemented by whoever can run a nested agent (the AgentLoop). */
export type SubAgentRunner = (spec: SubAgentSpec, signal: AbortSignal) => Promise<SubAgentReport>;

/** Minimal counting semaphore — no dependency, deterministic ordering. */
class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  get inFlight(): number {
    return this.active;
  }
}

export class SubAgentOrchestrator {
  private readonly semaphore: Semaphore;
  private peakConcurrency = 0;

  constructor(
    private readonly runner: SubAgentRunner,
    private readonly ctx: RunContext,
    private readonly config: HarnessConfig,
  ) {
    this.semaphore = new Semaphore(Math.max(1, config.maxSubAgents));
  }

  /** Run one sub-agent under the concurrency cap and a wall-clock timeout. */
  async spawn(spec: SubAgentSpec): Promise<SubAgentReport> {
    const meta = runMeta(this.ctx);
    const id = shortId(10);
    this.ctx.infra.bus.emit(
      'subagent.spawned',
      {
        id,
        goal: spec.goal,
        parentTaskId: this.ctx.taskId,
        ...(spec.model ? { model: spec.model } : {}),
        ...(spec.role ? { role: spec.role } : {}),
      },
      meta,
    );
    const release = await this.semaphore.acquire();
    this.peakConcurrency = Math.max(this.peakConcurrency, this.semaphore.inFlight);
    this.ctx.infra.metrics.gauge('subagent.concurrent_peak', this.peakConcurrency);

    const controller = new AbortController();
    const timeoutMs = spec.timeoutMs ?? this.config.toolTimeoutMs * 10;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = this.ctx.ports.clock.now();

    try {
      const report = await this.runner(spec, controller.signal);
      // The spawned id is the one the UI already rendered. The runner's own id
      // would otherwise leave a stuck "running" row next to a second finished row.
      const capped = this.capReport({ ...report, id });
      this.ctx.infra.metrics.observe('subagent.report_tokens', estimateTokens(capped.summary));
      this.ctx.infra.bus.emit('subagent.finished', { report: capped }, meta);
      return capped;
    } catch (error) {
      this.ctx.infra.metrics.inc('subagent.failure');
      const failed: SubAgentReport = {
        id: newId(),
        parentTaskId: this.ctx.taskId,
        goal: spec.goal,
        status: 'error',
        summary: `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}`,
        artifacts: [],
        verdicts: [],
        tokensUsed: 0,
        startedAt,
        endedAt: this.ctx.ports.clock.now(),
      };
      this.ctx.infra.bus.emit('subagent.finished', { report: failed }, meta);
      return failed;
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  /** Run several sub-agents; concurrency is enforced by the semaphore. */
  async spawnAll(specs: SubAgentSpec[]): Promise<SubAgentReport[]> {
    return Promise.all(specs.map((spec) => this.spawn(spec)));
  }

  /** Merge sub-agent artifacts/verdicts into a single parent-visible digest. */
  static digest(reports: SubAgentReport[]): { artifacts: Artifact[]; verdicts: Verdict[]; summary: string } {
    const artifacts: Artifact[] = [];
    const verdicts: Verdict[] = [];
    const lines: string[] = [];
    for (const report of reports) {
      artifacts.push(...report.artifacts);
      verdicts.push(...report.verdicts);
      lines.push(`- [${report.status}] ${report.goal}: ${report.summary.slice(0, 240)}`);
    }
    return { artifacts, verdicts, summary: lines.join('\n') };
  }

  /** Enforce the report token budget from config (whitepaper §3.6). */
  private capReport(report: SubAgentReport): SubAgentReport {
    const cap = this.config.subAgentReportTokenCap;
    if (estimateTokens(report.summary) <= cap) return report;
    const maxChars = Math.floor(cap * 3.6);
    return {
      ...report,
      summary: `${report.summary.slice(0, maxChars)}\n... [sub-agent summary truncated to ${cap} tokens]`,
    };
  }
}

export type { Id };