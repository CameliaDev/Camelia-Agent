/**
 * @camelia/harness — the task engine.
 *
 * Depends only on `@camelia/core`. Owns the agent loop, planning, execution,
 * verification, context management, tools, approval, checkpoints and recovery.
 * It has no knowledge of providers or UI: those are injected through `RunContext`
 * (whitepaper §2.2).
 *
 * Dependency direction: `core <- harness <- agent <- ui`. Never the reverse.
 *
 * @packageDocumentation
 */

// ---- configuration ---------------------------------------------------------
export * from './config.js';

// ---- run context -----------------------------------------------------------
export * from './context/RunContext.js';
export * from './context/ContextManager.js';
export * from './context/workspace-summary.js';

// ---- model access ----------------------------------------------------------
export * from './model/ModelGateway.js';
export * from './model/text-tool-calls.js';

// ---- prompts ---------------------------------------------------------------
export * from './prompts/system.js';

// ---- planning --------------------------------------------------------------
export * from './planning/Planner.js';
export * from './planning/PlanGate.js';
export * from './planning/plan-edits.js';
export * from './planning/Clarifier.js';
export * from './planning/plan-utils.js';
export * from './planning/json.js';

// ---- execution -------------------------------------------------------------
export * from './execution/Executor.js';

// ---- verification ----------------------------------------------------------
export * from './verification/Verifier.js';

// ---- tools -----------------------------------------------------------------
export * from './tools/types.js';
export * from './tools/ToolEngine.js';
export * from './tools/schema-validator.js';
export * from './tools/builtin/index.js';
export * from './mechanisms/MechanismHost.js';

// ---- approval & safety -----------------------------------------------------
export * from './approval/ApprovalGate.js';

// ---- checkpoints & rollback ------------------------------------------------
export * from './checkpoint/WorkspaceJournal.js';

// ---- reliability -----------------------------------------------------------
export * from './reliability/DriftDetector.js';
export * from './reliability/LoopDetector.js';
export * from './reliability/HallucinationGuard.js';

// ---- recovery --------------------------------------------------------------
export * from './recovery/ErrorRecovery.js';

// ---- sub-agents ------------------------------------------------------------
export * from './subagent/SubAgentOrchestrator.js';

// ---- term team -------------------------------------------------------------
export * from './team/assign-roles.js';
export * from './team/plan.js';
export * from './team/TeamOrchestrator.js';

// ---- memory lifecycle (Iteration 20) ---------------------------------------
export * from './memory/MemoryService.js';
export * from './memory/value.js';
export * from './memory/recallNoise.js';

// ---- self-review (Iteration 20) ---------------------------------------------
export * from './selfreview/PlanSelfReview.js';

// ---- MCP (Model Context Protocol) ------------------------------------------
export * from './mcp/transport.js';
export * from './mcp/McpClient.js';

// ---- agent loop ------------------------------------------------------------
export * from './loop/AgentLoop.js';