# Work token gate

Stage 16 of `docs/ROADMAP-30-PHASES.md`. Freeze: `docs/ARCH-Camelia-v7.md`.
This protocol is the Work-mode sub-AI gate. It is not the Phase 4 residual router and it is not `translate()`.

## Rule

A sub-AI may call a tool only while it holds an **active work token**.

1. The sub-AI thinks first. The thought is JSON:

   ```json
   { "goals": ["one sentence"], "constraints": ["bounds"], "plan": ["short step"] }
   ```

   `goals` and `plan` must each contain at least one non-empty string. `constraints` may be empty.

2. `WorkTokenGate.issue` returns a token only when that thought is present. A missing thought is a refusal. No token is created, so nothing is handed back.

3. `WorkTokenGate.authorize(tokenId, tool, input)` is the only way a tool call proceeds.
   - No token, or an unknown id: **refuse**. The tool does not run. `handedBack` is false because there was no token to return.
   - Tool name not in `allowedTools` (and the list is not `*`): **hand back**. The token status becomes `returned`. The tool does not run.
   - A path argument (`path`, `file`, `cwd`, or `target`) that sits outside `pathPrefixes`, when prefixes are set: **hand back**. The tool does not run.
   - `toolCalls` already at `maxToolCalls`: **hand back**. The tool does not run.
   - Otherwise the call is counted and may run.

4. A returned token stays returned. Later calls on it are refused and reported as already handed back.

5. Handing back means the parent (the main Work AI) receives the reason in the worker summary (`handed back: …`). The parent decides the next step. The sub-AI does not keep calling tools.

## Who holds a token

The main Work chat does not need a token to use its own tools. Those calls still go through the chat permission policy (`readonly-sandbox`, `ask`, `full`).

Sub-AIs spawned by `invoke_subagents` do. `runTokenGatedWorker` returns immediately, without calling `invoke`, when the token is missing or not `active`. It calls `authorize` before every `invoke`. A denied decision never reaches `invoke`.

## Delegation

`delegateWork` (stage 17):

- Recalls shared memory and puts it in the coordinator prompt and the worker prompt.
- Asks the coordinator for the same worker JSON `TeamOrchestrator` already parses (`parseTeamWorkers`).
- Issues a token per worker that produced a thought.
- When a `TeamOrchestrator` is present, admitted workers go through `TeamOrchestrator.dispatch`. That path assigns models and spawns sub-agents. It does **not** open the task plan gate (`plan.started` / `approve`). Term runs keep using `TeamOrchestrator.run`.
- Workers that never received a token are not spawned.

Events, reserved and emitted:

| Event | Meaning |
|-------|---------|
| `work.token` | `issued`, `denied` (no thought / no token), or `returned` (out of bounds) |
| `work.delegated` | worker count, hand-back count, summary |
| `work.mode_set` | Work scaffold posture: `chat` \| `plan` \| `goal` |
| `work.plan_saved` | a stored plan or goal note |

`work.plan_saved` is a note. It does not create a task, clarify an intent, or approve a plan.

## Code

- `packages/harness/src/work/WorkTokenGate.ts`
- `packages/harness/src/work/thought.ts`
- `packages/harness/src/work/gated-worker.ts`
- `packages/harness/src/work/WorkDelegation.ts`
- `packages/harness/src/team/TeamOrchestrator.ts` — `dispatch`
- `packages/agent/src/runtime/ChatLoop.ts` — `invoke_subagents`
- `packages/agent/src/runtime/CameliaRuntime.ts` — wires memory, the gate, and `TeamOrchestrator`
