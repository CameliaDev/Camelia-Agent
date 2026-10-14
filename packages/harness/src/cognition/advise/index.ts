/**
 * Phase 4 advise path. Pure pieces plus one session that holds the gate,
 * the exploration budget, and the heuristic table. The agent loop asks for a
 * ticket. It does not ask this module to change a plan.
 * @module
 */

export { criticalDiff } from './diff.js';
export { classifyAdviseError, classifyEnvironment, hardGateOf, sealErrorClass, softGateOf } from './error-class.js';
export { EnvironmentLedger, checkEnvironment } from './environment.js';
export type { EnvironmentCheck, EnvironmentLog, EnvironmentProbeOptions } from './environment.js';
export { parseHeuristicTable } from './heuristic.js';
export type { HeuristicRule, HeuristicTable, ParseTableResult } from './heuristic.js';
export { DEFAULT_HEURISTIC_JSON, defaultHeuristicTable, readShippedHeuristicFile } from './default-table.js';
export { routeA, routeB } from './router.js';
export type { ActionSample, RouterAResult, RouterBResult } from './router.js';
export { translate, validateContext, validateTranslated } from './translate.js';
export type { TranslateContext, TranslateResult } from './translate.js';
export { validateRollback } from './rollback.js';
export type { RollbackCheck, RollbackEvidence } from './rollback.js';
export {
  createGate,
  explorationAllowed,
  manualLower,
  manualRaise,
  noteStructuredMismatch,
  noteSuccess,
  requiresHuman,
  streakKey,
} from './gate.js';
export type { GateState } from './gate.js';
export { canExplore, consumeExplore, dayKey, emptyBudget, noteDemand } from './exploration.js';
export type { BudgetState, DemandCell } from './exploration.js';
export { bumpResidual, emptyMetrics, noteSkillWritten, snapshotMetrics } from './metrics.js';
export type { MetricsState } from './metrics.js';
export { AdviseSession, createAdviseSession } from './session.js';
export type { AdviseInput, AdviseOutcome, CommitInput } from './session.js';
