# Camelia progress log

One-line summaries per landed PR / agent run. Newest first.

| Date (UTC) | Stage | Summary |
|------------|-------|---------|
| 2026-10-14 | 20–23 | Work team toggle + `TeamOrchestrationCard`; Term tab soft-deprecated; v7 rollback enums + translate validator stubs; v8 right-rail `health` panel; ARCH v7/v8 + ROADMAP in `docs/`. |
| — | 1–19 | Baseline per `docs/ROADMAP-30-PHASES.md` waves A–C (parallel agents for 9–19). |

## Conflict notes

- **Phase 4 agent** may touch `packages/harness/src/cognition/*` and residual router — this branch adds `translate-schema.ts`, `memory-write-gate.ts`, and `recovery/rollback-point.ts` additively; merge by keeping both validator entry points if duplicated.
- **Work agent** may change `Composer.tsx` (folder drop, prompts) — team toggle is isolated behind `data-composer-team`; resolve by retaining both toolbar affordances.
