/**
 * Full-engine assembly for integration tests.
 *
 * The unit tests exercise each subsystem in isolation; this module wires them the
 * same way `CameliaRuntime` does, so the AgentLoop can be driven end to end
 * against fakes. Keeping the wiring here (not in each test) means the integration
 * tests assert *behaviour*, not *assembly*.
 * @module
 */

import {
  AgentLoop,
  ApprovalGate,
  ContextManager,
  DriftDetector,
  ErrorRecovery,
  Executor,
  LoopDetector,
  MemoryService,
  ModelGateway,
  CognitionService,
  ObserveOnlyPolicy,
  PlanGate,
  PlanSelfReview,
  Planner,
  SubAgentOrchestrator,
  ToolEngine,
  Verifier,
  WorkspaceJournal,
  builtinTools,
  emptySlots,
} from '../../src/index.js';
import { runMeta } from '../../src/context/RunContext.js';

import type { CognitionPort } from '@camelia/core';

import type { CognitivePolicy } from '../../src/index.js';
import type { Harness } from './context.js';

export interface Engine {
  loop: AgentLoop;
  gateway: ModelGateway;
  context: ContextManager;
  journal: WorkspaceJournal;
  tools: ToolEngine;
  approval: ApprovalGate;
  subAgents: SubAgentOrchestrator;
  planner: Planner;
  verifier: Verifier;
}

export interface EngineOptions {
  /** Tool names the approval responder refuses (everything else is approved). */
  denyTools?: string[];
  /** Backup root handed to the journal. */
  backupRoot?: string;
  /** Extra tools registered on top of the built-ins. */
  extraTools?: Parameters<ToolEngine['registerAll']>[0];
  planGate?: PlanGate;
  /** When set, the loop records predictions. Omit it to keep a run free of cognition events. */
  cognition?: CognitionPort | 'on';
  cognitivePolicy?: CognitivePolicy;
}

/**
 * Assemble the whole engine over a fake-backed `RunContext`.
 *
 * The sub-agent orchestrator and the loop are mutually dependent, so a late-bound
 * holder breaks the cycle exactly as the production composition root does.
 */
export function buildEngine(h: Harness, options: EngineOptions = {}): Engine {
  const ctx = h.ctx;
  const denied = new Set(options.denyTools ?? []);
  const responder = async (request: { name: string }): Promise<boolean> => !denied.has(request.name);

  const gateway = new ModelGateway(ctx);
  const context = new ContextManager(ctx.config, emptySlots(), undefined, h.logger, h.metrics);
  const approval = new ApprovalGate(ctx.config.approval, responder, h.logger, h.metrics);
  const loopDetector = new LoopDetector(ctx.config.loopRepeatThreshold);
  const drift = new DriftDetector(ctx.config.driftThreshold);
  const recovery = new ErrorRecovery(ctx.config.maxRetries);
  const planner = new Planner(gateway, ctx);
  const journal = new WorkspaceJournal(options.backupRoot ?? 'C:/backups', ctx.taskId, h.fs, h.logger);

  const tools = new ToolEngine(h.logger, h.metrics);
  tools.registerAll(builtinTools);
  if (options.extraTools) tools.registerAll(options.extraTools);

  const executor = new Executor(
    { gateway, tools, approval, context, journal, loop: loopDetector, config: ctx.config },
    ctx,
  );
  const verifier = new Verifier(ctx, { approval });

  const holder: { current?: AgentLoop } = {};
  const subAgents = new SubAgentOrchestrator(
    (spec, signal) => {
      if (!holder.current) throw new Error('sub-agent requested before the loop was ready');
      return holder.current.runSubAgent(spec, signal);
    },
    ctx,
    ctx.config,
  );

  const loop = new AgentLoop(
    {
      gateway,
      planner,
      executor,
      verifier,
      recovery,
      context,
      journal,
      loop: loopDetector,
      drift,
      subAgents,
      config: ctx.config,
      planGate: options.planGate,
      selfReview: new PlanSelfReview(),
      cognition:
        options.cognition === 'on'
          ? new CognitionService({
              store: ctx.infra.store,
              minLevelSamples: ctx.config.cognitionLevelSamples,
              minSamples: ctx.config.cognitionMinSamples,
              surprisePercentile: ctx.config.cognitionSurprisePercentile,
              logger: h.logger,
            })
          : options.cognition,
      cognitivePolicy: options.cognition ? (options.cognitivePolicy ?? new ObserveOnlyPolicy()) : options.cognitivePolicy,
      memory: new MemoryService({
        store: ctx.infra.store,
        bus: ctx.infra.bus,
        logger: h.logger,
        metrics: h.metrics,
        clock: ctx.ports.clock,
        budget: ctx.config.memoryBudget,
        halfLifeMs: ctx.config.memoryHalfLifeMs,
        meta: runMeta(ctx),
      }),
    },
    ctx,
  );
  holder.current = loop;

  return { loop, gateway, context, journal, tools, approval, subAgents, planner, verifier };
}