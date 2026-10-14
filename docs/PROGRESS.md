# Camelia progress log

One-line summaries per landed PR / agent run. Newest first.

| Date (UTC) | Stage | Summary |
|------------|-------|---------|
| 2026-10-14 | 15–19 | Work chat thinks first (goal, constraints, short plan, then tools); `WorkTokenGate` plus `docs/WORK-TOKEN-GATE.md`; main AI `invoke_subagents` reuses `TeamOrchestrator.dispatch` and shared memory; Plan/Goal scaffold (`work.mode_set`, `work.plan_saved`); composer folder drop. Phase 4 router/translate left untouched. |
| 2026-10-14 | 20–23 | Work team toggle + `TeamOrchestrationCard`; Term tab soft-deprecated; v7 rollback enums + translate validator stubs; v8 right-rail `health` panel; ARCH v7/v8 + ROADMAP in `docs/`. |
| — | 1–14 | Baseline per `docs/ROADMAP-30-PHASES.md` waves A–B (Phase 4 still the other agent). |

## Conflict notes

- **Phase 4** (router / `translate`) stays with the other agent. Stages 20–23 already landed the validator stubs on `main`. This branch does not edit `packages/harness/src/cognition/*` or `recovery/rollback-point.ts`.
- **Work agent** (stages 15–19) kept the stage-20 team toggle (`data-composer-team`) and added Plan/Goal plus folder drop beside it.
