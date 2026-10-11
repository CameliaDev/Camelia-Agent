/**
 * Deterministic event scripts for the fixture transport.
 *
 * Every screenshot, every UI test and every visual self-check runs on one of these
 * scripts. They are plain arrays of domain events with fixed timestamps, so folding
 * them twice yields byte-identical snapshots (whitepaper §6.1: the UI is a projection
 * of task state, never an invention of its own).
 *
 * The scripts are deliberately *realistic*, not minimal: they exercise the whole
 * architecture surface the UI must expose — task phase, per-step status, weighted
 * progress, tool input/output/duration, an approval gate, a context compaction with
 * its protected slots, a running and a finished sub-agent, a tool failure with an
 * automatic recovery, a drift notice, a blocked hallucination, and a final delivery.
 *
 * @module
 */

import type {
  AcceptancePoint,
  Artifact,
  Checkpoint,
  DomainEvent,
  DomainEventMap,
  DomainEventOf,
  DomainEventType,
  JsonObject,
  JsonValue,
  Plan,
  RiskLevel,
  Step,
  SubAgentReport,
  Task,
  ToolCall,
  ToolCallStatus,
  Verdict,
} from '@camelia/core';

import type { ProviderStatus, SessionView } from '@camelia/agent/view';

/** Named, reproducible UI states. `?scene=<id>` selects one. */
export type SceneId =
  | 'empty'
  | 'connecting'
  | 'planning'
  | 'plan'
  | 'diff'
  | 'running'
  | 'approval'
  | 'failure'
  | 'error'
  | 'done';

export const SCENES: { id: SceneId; label: string; blurb: string }[] = [
  { id: 'empty', label: 'Idle', blurb: 'No task yet — the empty state.' },
  { id: 'connecting', label: 'Connecting', blurb: 'Bootstrap landed, the engine has not answered yet — the loading state.' },
  { id: 'planning', label: 'Planning', blurb: 'Intent clarified, plan being drafted.' },
  { id: 'plan', label: 'Plan review', blurb: 'The plan is waiting for approval before any step runs.' },
  { id: 'diff', label: 'Editing', blurb: 'A live edit with its diff open, a sub-agent finished, context compacted.' },
  { id: 'running', label: 'Running', blurb: 'Mid-flight: steps, tools, context, sub-agent.' },
  { id: 'approval', label: 'Approval', blurb: 'A privileged shell command waits for consent.' },
  { id: 'failure', label: 'Recovery', blurb: 'Failure, automatic recovery, drift and hallucination guards.' },
  { id: 'error', label: 'Unreachable', blurb: 'The engine could not be reached — the transport error state.' },
  { id: 'done', label: 'Delivered', blurb: 'All steps verified, artifacts delivered.' },
];

// ---------------------------------------------------------------------------
// fixed identities — screenshots must be byte-reproducible
// ---------------------------------------------------------------------------

const BASE = 1_759_512_000_000; // 2025-10-03T08:00:00Z, frozen on purpose
const TRACE = 'trc_7f3a91c2';
const SESSION_ID = 'ses_4b1e0c';
const TASK_ID = 'tsk_9c02af';
const WORKSPACE = 'C:/Users/dev/projects/camelia-code';

export const PRIMARY_SESSION: SessionView = {
  id: SESSION_ID,
  title: 'Add --json output to the camelia CLI',
  workspace: WORKSPACE,
  provider: 'openrouter',
  model: 'qwen3-coder:free',
};

export const SESSION_LIST: SessionView[] = [
  PRIMARY_SESSION,
  {
    id: 'ses_2a77d1',
    title: 'Harden the context compactor',
    workspace: 'C:/Users/dev/projects/camelia-code',
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
  },
  {
    id: 'ses_91bb03',
    title: 'Refactor the tool engine schemas',
    workspace: 'C:/Users/dev/projects/atlas',
    provider: 'opencode-zen',
    model: 'big-pickle',
  },
];

export const BOOTSTRAP_PROVIDER = { activeProvider: 'openrouter', activeModel: 'qwen3-coder:free' };

/**
 * The scripted engine's provider-connection state — the fixture's stand-in for
 * `GET /health`. Kept in lockstep with `BOOTSTRAP_PROVIDER` so the scripted path
 * exercises the same header states the live engine produces.
 */
export const BOOTSTRAP_PROVIDER_STATUS: ProviderStatus = {
  state: 'connected',
  id: BOOTSTRAP_PROVIDER.activeProvider,
  model: BOOTSTRAP_PROVIDER.activeModel,
  chain: ['opencode-zen', 'openrouter', 'ollama'],
};

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

function env<T extends DomainEventType>(
  type: T,
  payload: DomainEventMap[T],
  ts: number,
): DomainEventOf<T> {
  return { type, payload, traceId: TRACE, sessionId: SESSION_ID, taskId: TASK_ID, ts: BASE + ts };
}

function ap(
  id: string,
  description: string,
  kind: AcceptancePoint['kind'],
  params: JsonObject = {},
): AcceptancePoint {
  return { id, description, kind, params };
}

function step(
  idx: number,
  title: string,
  goal: string,
  weight: number,
  acceptance: AcceptancePoint[],
): Step {
  return {
    id: `stp_${idx}`,
    taskId: TASK_ID,
    idx,
    title,
    goal,
    status: 'pending',
    acceptance,
    weight,
    deps: idx === 0 ? [] : [`stp_${idx - 1}`],
  };
}

interface CallSpec {
  id: string;
  stepId: string;
  name: string;
  input: JsonValue;
  risk: RiskLevel;
  reversible: boolean;
  status: ToolCallStatus;
  output?: JsonValue;
  durationMs?: number;
  error?: string;
  at: number;
}

function call(spec: CallSpec): ToolCall {
  return {
    id: spec.id,
    stepId: spec.stepId,
    taskId: TASK_ID,
    name: spec.name,
    input: spec.input,
    output: spec.output,
    status: spec.status,
    risk: spec.risk,
    reversible: spec.reversible,
    durationMs: spec.durationMs,
    error: spec.error,
    traceId: TRACE,
    createdAt: BASE + spec.at,
  };
}

export const PLANNED_STEPS: Step[] = [
  step(0, 'Map the CLI entrypoint and the report generator', 'Find where flags are parsed and where the acceptance report is rendered.', 1, [
    ap('ap_0a', 'packages/cli/src/main.ts exists', 'file-exists', { path: 'packages/cli/src/main.ts' }),
    ap('ap_0b', 'report renderer located', 'file-contains', { path: 'scripts/acceptance-report.ts', pattern: 'renderReport' }),
  ]),
  step(1, 'Parse a --json flag in the CLI', 'Accept `--json` and thread it into the run options without touching the human-readable path.', 1, [
    ap('ap_1a', 'main.ts parses --json', 'file-contains', { path: 'packages/cli/src/main.ts', pattern: '--json' }),
  ]),
  step(2, 'Thread the flag into the report renderer', 'Make the report emit machine-readable JSON when the flag is set.', 2, [
    ap('ap_2a', 'renderer branches on format', 'file-contains', { path: 'scripts/acceptance-report.ts', pattern: 'format' }),
    ap('ap_2b', 'renderer still emits the table by default', 'test-pass', { suite: 'scripts/acceptance-report.test.ts' }),
  ]),
  step(3, 'Extend the acceptance tests for JSON output', 'Cover the new flag end-to-end, including the default path staying unchanged.', 1, [
    ap('ap_3a', 'cli e2e suite passes', 'test-pass', { suite: 'tests/acceptance/cli.e2e.test.ts' }),
  ]),
  step(4, 'Run the full workspace suite and confirm green', 'No regressions anywhere in the monorepo.', 2, [
    ap('ap_4a', 'workspace suite exits zero', 'command-exit-zero', { cmd: 'pnpm -w test' }),
  ]),
];

function withStatus(s: Step, status: Step['status'], startedAt?: number, endedAt?: number): Step {
  return { ...s, status, startedAt: startedAt === undefined ? undefined : BASE + startedAt, endedAt: endedAt === undefined ? undefined : BASE + endedAt };
}

function plan(): Plan {
  return { id: 'pln_7c41', taskId: TASK_ID, steps: PLANNED_STEPS, mode: 'full', revision: 1, createdAt: BASE + 190 };
}

/** The standard plan, retagged for a different task — used when the fixture is asked to start a fresh run. */
export function planFor(taskId: string, createdAt: number): Plan {
  return {
    id: `pln_${taskId.slice(-4)}`,
    taskId,
    steps: PLANNED_STEPS.map((s) => ({ ...s, taskId, status: 'pending', startedAt: undefined, endedAt: undefined })),
    mode: 'full',
    revision: 1,
    createdAt,
  };
}

function verdict(stepId: string, status: Verdict['status'], reason: string, at: number): Verdict {
  return { id: `vrd_${stepId}_${at}`, stepId, taskId: TASK_ID, status, evidence: [], reason, createdAt: BASE + at };
}

function checkpoint(id: string, stepIdx: number, summary: string, at: number): Checkpoint {
  return {
    id,
    taskId: TASK_ID,
    stepIdx,
    ctxSummary: summary,
    fsManifest: { entries: {} },
    createdAt: BASE + at,
  };
}

function artifact(kind: Artifact['kind'], path: string, hash: string, sizeBytes: number): Artifact {
  return { kind, path, hash, sizeBytes };
}

const MAIN_TS_BEFORE = `export async function main(argv: string[]) {
  const opts = parseArgs(argv);
  const report = await runAcceptance(opts);
  renderReport(report);
}`;

const MAIN_TS_AFTER = `export async function main(argv: string[]) {
  const opts = parseArgs(argv);
  if (opts.json) {
    renderReport(await runAcceptance(opts), { format: 'json' });
    return;
  }
  renderReport(await runAcceptance(opts));
}`;

const REPORT_BEFORE = `export function renderReport(report: Report) {
  const rows = report.suites.map(toRow);
  process.stdout.write(table(rows));
}`;

const REPORT_AFTER = `export function renderReport(report: Report, opts: { format?: 'table' | 'json' } = {}) {
  const format = opts.format ?? 'table';
  if (format === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }
  const rows = report.suites.map(toRow);
  process.stdout.write(table(rows));
}`;

const TEST_BEFORE = `  expect(res.stdout).toContain('suite');`;

const TEST_AFTER = `  expect(res.stdout).toContain('suite');
  const json = JSON.parse(await runCli(['--json']));
  expect(json.suites).toBeInstanceOf(Array);`;

// ---------------------------------------------------------------------------
// the master script
// ---------------------------------------------------------------------------

interface Script {
  beats: DomainEvent[];
  marks: Partial<Record<'planning' | 'plan' | 'diff' | 'running' | 'approval' | 'failure', number>>;
}

function buildScript(): Script {
  const beats: DomainEvent[] = [];
  const marks: Script['marks'] = {};
  const add = <T extends DomainEventType>(type: T, payload: DomainEventMap[T], ts: number): void => {
    beats.push(env(type, payload, ts) as DomainEvent);
  };
  const narrate = (text: string, ts: number): void => {
    add('log', { level: 'debug', message: text, meta: { stream: true } }, ts);
  };

  const initialTask: Task = {
    id: TASK_ID,
    sessionId: SESSION_ID,
    intentRaw: 'Add a --json flag to the camelia CLI and make the acceptance report consume it.',
    status: 'received',
    phase: 'idle',
    progress: 0,
    createdAt: BASE,
    updatedAt: BASE,
  };

  // ---- intake ------------------------------------------------------------
  add('task.received', { task: initialTask }, 0);
  add('metric', { name: 'task.received', value: 1 }, 4);
  add('provider.selected', { providerId: 'opencode-zen', model: 'big-pickle', reason: 'free primary path' }, 30);
  add('provider.capabilities', {
    providerId: 'opencode-zen',
    capabilities: { supportsTools: true, supportsJson: true, supportsStreaming: true, maxContextWindow: 32768, quality: 0.62 },
  }, 32);
  add('provider.fallback', { from: 'opencode-zen', to: 'openrouter', reason: 'HTTP 429 — free tier rate limited', depth: 1 }, 48);
  add('provider.selected', { providerId: 'openrouter', model: 'qwen3-coder:free', reason: 'fallback depth 1' }, 50);

  narrate("I'll locate the CLI entrypoint and the acceptance report first, then thread a `--json` flag through both.", 70);
  add('task.status_changed', { from: 'received', to: 'clarifying', reason: 'intent received' }, 90);
  add('task.clarified', {
    intent: {
      goal: 'Add a --json flag to the camelia CLI and make the acceptance report consume it.',
      assumptions: ['Node ESM, no new dependencies', 'The human-readable table stays the default'],
      constraints: ['Do not change existing human-readable output'],
      expectedPaths: ['packages/cli/src/main.ts', 'scripts/acceptance-report.ts', 'tests/acceptance/cli.e2e.test.ts'],
      complete: true,
    },
  }, 110);
  add('task.status_changed', { from: 'clarifying', to: 'planning', reason: 'intent clarified' }, 130);
  add('plan.started', { mode: 'full' }, 140);

  marks.planning = beats.length;

  add('plan.ready', { plan: plan() }, 190);
  add('task.status_changed', { from: 'planning', to: 'awaiting-approval', reason: 'plan ready' }, 200);
  add('task.phase_changed', { phase: 'awaiting-approval' }, 202);
  marks.plan = beats.length;
  add('task.status_changed', { from: 'awaiting-approval', to: 'executing', reason: 'plan accepted' }, 210);
  add('task.phase_changed', { phase: 'executing' }, 212);
  add('context.budget', { budget: { window: 32768, softLimit: 26214, used: 1840 } }, 220);
  add('task.progress', { progress: 0, currentStepIdx: 0, totalSteps: 5 }, 225);

  // ---- step 0 ------------------------------------------------------------
  add('step.started', { step: withStatus(PLANNED_STEPS[0]!, 'running', 240) }, 240);
  narrate('Step 1 — read the CLI entrypoint and grep for the report generator. ', 252);
  const c01 = call({ id: 'cal_01', stepId: 'stp_0', name: 'fs.read', input: { path: 'packages/cli/src/main.ts' }, risk: 'read-only', reversible: true, status: 'pending', at: 260 });
  add('tool.requested', { call: c01 }, 260);
  add('tool.started', { callId: c01.id, name: c01.name }, 262);
  add('tool.finished', { call: call({ ...c01, status: 'ok', output: { lines: 412, bytes: 14320 }, durationMs: 38, at: 300 }) }, 300);
  const c02 = call({ id: 'cal_02', stepId: 'stp_0', name: 'search.grep', input: { pattern: 'renderReport', glob: 'scripts/**' }, risk: 'read-only', reversible: true, status: 'pending', at: 310 });
  add('tool.requested', { call: c02 }, 310);
  add('tool.started', { callId: c02.id, name: c02.name }, 312);
  add('tool.finished', { call: call({ ...c02, status: 'ok', output: { matches: 6, files: ['scripts/acceptance-report.ts'] }, durationMs: 22, at: 350 }) }, 350);
  add('verify.started', { stepId: 'stp_0', points: 2 }, 360);
  add('verify.result', { verdict: verdict('stp_0', 'pass', 'main.ts and the report renderer both located', 380) }, 380);
  add('step.completed', { step: withStatus(PLANNED_STEPS[0]!, 'done', 240, 390), result: { stepId: 'stp_0', status: 'ok', toolCalls: [], summary: 'Located both files.', artifacts: [artifact('report', 'notes/cli-map.md', 'b1c9', 1180)] } }, 390);
  add('checkpoint.created', { checkpoint: checkpoint('ckp_01', 0, 'step 0 done — CLI map recorded', 395) }, 395);
  add('task.progress', { progress: 0.14, currentStepIdx: 0, totalSteps: 5 }, 400);

  // ---- step 1 ------------------------------------------------------------
  add('step.started', { step: withStatus(PLANNED_STEPS[1]!, 'running', 420) }, 420);
  narrate('Adding the flag parser. I keep the existing branch untouched and return early for JSON. ', 432);
  add('context.budget', { budget: { window: 32768, softLimit: 26214, used: 5210 } }, 440);
  const c03 = call({ id: 'cal_03', stepId: 'stp_1', name: 'fs.edit', input: { path: 'packages/cli/src/main.ts', oldText: MAIN_TS_BEFORE, newText: MAIN_TS_AFTER }, risk: 'write', reversible: true, status: 'pending', at: 450 });
  add('tool.requested', { call: c03 }, 450);
  add('tool.started', { callId: c03.id, name: c03.name }, 452);
  add('tool.finished', { call: call({ ...c03, status: 'ok', output: { path: 'packages/cli/src/main.ts', added: 6, removed: 0, hash: 'a91f' }, durationMs: 64, at: 520 }) }, 520);
  add('verify.started', { stepId: 'stp_1', points: 1 }, 540);
  add('verify.result', { verdict: verdict('stp_1', 'pass', 'main.ts now parses --json and returns early', 560) }, 560);
  add('step.completed', { step: withStatus(PLANNED_STEPS[1]!, 'done', 420, 570), result: { stepId: 'stp_1', status: 'ok', toolCalls: [], summary: 'Flag parsed.', artifacts: [artifact('diff', 'packages/cli/src/main.ts', 'a91f', 210)] } }, 570);
  add('checkpoint.created', { checkpoint: checkpoint('ckp_02', 1, 'step 1 done — flag parsed', 575) }, 575);
  add('task.progress', { progress: 0.29, currentStepIdx: 1, totalSteps: 5 }, 580);

  // ---- step 2 ------------------------------------------------------------
  add('step.started', { step: withStatus(PLANNED_STEPS[2]!, 'running', 600) }, 600);
  narrate("The renderer is large, so I'll delegate the line-range hunt to a sub-agent and keep the main context lean. ", 612);
  add('subagent.spawned', { id: 'sub_01', goal: 'Locate the format switch in scripts/acceptance-report.ts and report the exact line range.', parentTaskId: TASK_ID }, 620);
  const c04 = call({ id: 'cal_04', stepId: 'stp_2', name: 'fs.read', input: { path: 'scripts/acceptance-report.ts' }, risk: 'read-only', reversible: true, status: 'pending', at: 640 });
  add('tool.requested', { call: c04 }, 640);
  add('tool.started', { callId: c04.id, name: c04.name }, 642);
  add('tool.finished', { call: call({ ...c04, status: 'ok', output: { lines: 286, bytes: 9210 }, durationMs: 31, at: 680 }) }, 680);
  add('context.compaction_started', { tokensBefore: 26880, reason: 'soft-limit' }, 700);
  add('context.compacted', {
    tokensBefore: 26880,
    tokensAfter: 9740,
    droppedMessages: 12,
    summaries: [
      'Steps 0–1: located the CLI entrypoint and added --json parsing (6 lines added in main.ts).',
      'Tool output elided: fs.read main.ts (412 lines), search.grep renderReport (6 matches).',
    ],
    droppedPreviews: [
      { role: 'user', content: 'Add a --json flag to the camelia CLI so the report can be piped into other tools.', truncated: false },
      { role: 'assistant', content: 'I will locate the CLI entrypoint, add the flag, and wire the renderer to switch formats.', truncated: false },
      { role: 'tool', name: 'search.glob', content: 'packages/cli/src/main.ts\npackages/cli/src/render.ts\npackages/cli/src/args.ts', truncated: false },
      { role: 'assistant', content: 'The entrypoint is packages/cli/src/main.ts. Reading it to find where options are parsed.', truncated: false },
      { role: 'tool', name: 'fs.read', content: 'export function main(argv: string[]): number {\n  const args = parseArgs(argv);\n  const report = runPipeline(args);\n  process.stdout.write(render(report));\n  return EXIT[report.status];\n}', truncated: false },
      { role: 'assistant', content: 'parseArgs owns the flag surface. Adding a boolean `json` option there and threading it through render().', truncated: false },
      { role: 'tool', name: 'fs.edit', content: '--- a/packages/cli/src/args.ts\n+++ b/packages/cli/src/args.ts\n@@ -18,6 +18,7 @@\n   spec?: string;\n+  json?: boolean;\n   resume?: string;', truncated: false },
      { role: 'tool', name: 'search.grep', content: 'render.ts:142:function renderReport(report: Report): string {\nrender.ts:168:  return lines.join("\\n");', truncated: false },
      { role: 'assistant', content: 'renderReport() at lines 142–168 is where the human format is assembled. I will branch on `format` there.', truncated: false },
      { role: 'tool', name: 'shell.exec', content: '> node --version\nv22.11.0', truncated: false },
      { role: 'tool', name: 'fs.list', content: 'packages/cli/src\n  args.ts\n  main.ts\n  render.ts\n  server/', truncated: false },
      { role: 'assistant', content: 'Plan is settled: parse the flag, branch the renderer, then verify with a snapshot test of the JSON shape.', truncated: false },
    ],
    protectedSlots: ['goal', 'constraints', 'todos', 'artifacts'],
  }, 720);
  add('context.budget', { budget: { window: 32768, softLimit: 26214, used: 9740 } }, 740);
  add('subagent.finished', {
    report: {
      id: 'sub_01',
      parentTaskId: TASK_ID,
      goal: 'Locate the format switch in scripts/acceptance-report.ts and report the exact line range.',
      status: 'ok',
      summary: 'The switch lives in renderReport() at lines 142–168; it branches on `format`.',
      artifacts: [artifact('report', 'subagent/sub_01.md', '4de2', 640)],
      verdicts: [],
      tokensUsed: 6120,
      startedAt: BASE + 620,
      endedAt: BASE + 760,
    } satisfies SubAgentReport,
  }, 760);
  const c05 = call({ id: 'cal_05', stepId: 'stp_2', name: 'fs.edit', input: { path: 'scripts/acceptance-report.ts', oldText: REPORT_BEFORE, newText: REPORT_AFTER }, risk: 'write', reversible: true, status: 'pending', at: 790 });
  add('tool.requested', { call: c05 }, 790);
  add('tool.started', { callId: c05.id, name: c05.name }, 792);
  add('tool.finished', { call: call({ ...c05, status: 'ok', output: { path: 'scripts/acceptance-report.ts', added: 7, removed: 1, hash: '7c02' }, durationMs: 71, at: 860 }) }, 860);

  marks.diff = beats.length;

  add('verify.started', { stepId: 'stp_2', points: 2 }, 880);
  add('verify.result', { verdict: verdict('stp_2', 'pass', 'renderer branches on format and still defaults to the table', 900) }, 900);
  add('step.completed', { step: withStatus(PLANNED_STEPS[2]!, 'done', 600, 910), result: { stepId: 'stp_2', status: 'ok', toolCalls: [], summary: 'Renderer threaded.', artifacts: [artifact('diff', 'scripts/acceptance-report.ts', '7c02', 260)] } }, 910);
  add('checkpoint.created', { checkpoint: checkpoint('ckp_03', 2, 'step 2 done — renderer threaded', 915) }, 915);
  add('task.progress', { progress: 0.57, currentStepIdx: 2, totalSteps: 5 }, 920);

  // ---- step 3: tests, a failure, a recovery -------------------------------
  add('step.started', { step: withStatus(PLANNED_STEPS[3]!, 'running', 940) }, 940);
  narrate('Extending the acceptance suite, then running it. ', 950);
  const c06 = call({ id: 'cal_06', stepId: 'stp_3', name: 'fs.edit', input: { path: 'tests/acceptance/cli.e2e.test.ts', oldText: TEST_BEFORE, newText: TEST_AFTER }, risk: 'write', reversible: true, status: 'pending', at: 960 });
  add('tool.requested', { call: c06 }, 960);
  add('tool.started', { callId: c06.id, name: c06.name }, 962);
  add('tool.finished', { call: call({ ...c06, status: 'ok', output: { path: 'tests/acceptance/cli.e2e.test.ts', added: 4, removed: 0, hash: 'e11a' }, durationMs: 44, at: 1030 }) }, 1030);

  marks.running = beats.length;

  const c07 = call({ id: 'cal_07', stepId: 'stp_3', name: 'shell.run', input: { cmd: 'pnpm -C tests test -- cli.e2e', cwd: 'tests' }, risk: 'privileged', reversible: false, status: 'awaiting-approval', at: 1050 });
  add('tool.requested', { call: { ...c07, status: 'pending' } }, 1050);
  add('tool.approval_required', { call: c07 }, 1052);

  marks.approval = beats.length;

  add('tool.approved', { callId: c07.id, by: 'user' }, 1080);
  add('tool.started', { callId: c07.id, name: c07.name }, 1082);
  add('tool.failed', { callId: c07.id, name: c07.name, error: 'exit code 1 — 2 tests failed (cli.e2e.test.ts:41, :57)', recoverable: true }, 1180);
  add('recovery.classified', { errorClass: 'exit-nonzero', message: 'the test run failed' }, 1190);
  add('recovery.attempted', { strategy: 'retry-with-context', attempt: 1 }, 1200);
  const c08 = call({ id: 'cal_08', stepId: 'stp_3', name: 'fs.read', input: { path: 'tests/acceptance/cli.e2e.test.ts' }, risk: 'read-only', reversible: true, status: 'pending', at: 1210 });
  add('tool.requested', { call: c08 }, 1210);
  add('tool.finished', { call: call({ ...c08, status: 'ok', output: { lines: 88 }, durationMs: 19, at: 1230 }) }, 1230);
  const c09 = call({ id: 'cal_09', stepId: 'stp_3', name: 'fs.edit', input: { path: 'tests/acceptance/cli.e2e.test.ts', oldText: "  expect(json.suites).toBeInstanceOf(Array);", newText: "  expect(Array.isArray(json.suites)).toBe(true);" }, risk: 'write', reversible: true, status: 'pending', at: 1240 });
  add('tool.requested', { call: c09 }, 1240);
  add('tool.started', { callId: c09.id, name: c09.name }, 1242);
  add('tool.finished', { call: call({ ...c09, status: 'ok', output: { path: 'tests/acceptance/cli.e2e.test.ts', added: 1, removed: 1, hash: '3fa1' }, durationMs: 52, at: 1250 }) }, 1250);
  const c10 = call({ id: 'cal_10', stepId: 'stp_3', name: 'shell.run', input: { cmd: 'pnpm -C tests test -- cli.e2e', cwd: 'tests' }, risk: 'privileged', reversible: false, status: 'pending', at: 1270 });
  add('tool.requested', { call: c10 }, 1270);
  add('tool.started', { callId: c10.id, name: c10.name }, 1272);
  add('tool.finished', { call: call({ ...c10, status: 'ok', output: { exitCode: 0, tests: 7, passed: 7 }, durationMs: 640, at: 1360 }) }, 1360);
  add('recovery.succeeded', { strategy: 'retry-with-context', attempts: 1 }, 1370);
  add('reliability.drift_detected', { score: 0.42, signals: ['the last three calls touched tests only, while the goal also names the report renderer'], action: 'reanchor' }, 1380);
  add('reliability.hallucination_blocked', { claim: 'All acceptance points verified', reason: 'step 3 had no verdict yet — the claim was downgraded to unverified' }, 1390);
  add('verify.started', { stepId: 'stp_3', points: 1 }, 1400);
  add('verify.result', { verdict: verdict('stp_3', 'pass', 'cli e2e suite: 7/7 green after the recovery', 1420) }, 1420);
  add('step.completed', { step: withStatus(PLANNED_STEPS[3]!, 'done', 940, 1430), result: { stepId: 'stp_3', status: 'ok', toolCalls: [], summary: 'Tests extended and green.', artifacts: [artifact('diff', 'tests/acceptance/cli.e2e.test.ts', '3fa1', 180)] } }, 1430);
  add('checkpoint.created', { checkpoint: checkpoint('ckp_04', 3, 'step 3 done — tests green after recovery', 1435) }, 1435);
  add('task.progress', { progress: 0.71, currentStepIdx: 3, totalSteps: 5 }, 1440);

  marks.failure = beats.length;

  // ---- step 4: full suite -------------------------------------------------
  add('step.started', { step: withStatus(PLANNED_STEPS[4]!, 'running', 1460) }, 1460);
  narrate('Final step — run the whole workspace suite to rule out regressions. ', 1470);
  add('context.budget', { budget: { window: 32768, softLimit: 26214, used: 14210 } }, 1480);
  const c11 = call({ id: 'cal_11', stepId: 'stp_4', name: 'shell.run', input: { cmd: 'pnpm -w test' }, risk: 'privileged', reversible: false, status: 'pending', at: 1490 });
  add('tool.requested', { call: c11 }, 1490);
  add('tool.started', { callId: c11.id, name: c11.name }, 1492);
  add('tool.finished', { call: call({ ...c11, status: 'ok', output: { exitCode: 0, suites: 9, tests: 506, passed: 506 }, durationMs: 2280, at: 1720 }) }, 1720);
  add('verify.started', { stepId: 'stp_4', points: 1 }, 1740);
  add('verify.result', { verdict: verdict('stp_4', 'pass', 'workspace suite green: 506/506', 1770) }, 1770);
  add('step.completed', { step: withStatus(PLANNED_STEPS[4]!, 'done', 1460, 1780), result: { stepId: 'stp_4', status: 'ok', toolCalls: [], summary: 'No regressions.', artifacts: [artifact('stdout', 'logs/workspace-suite.txt', '9b30', 4210)] } }, 1780);
  add('task.progress', { progress: 1, currentStepIdx: 4, totalSteps: 5 }, 1785);
  add('task.status_changed', { from: 'executing', to: 'verifying', reason: 'all steps complete' }, 1790);
  add('task.phase_changed', { phase: 'verifying' }, 1792);
  add('metric', { name: 'task.steps', value: 5 }, 1800);
  add('metric', { name: 'context.peak_tokens', value: 26880 }, 1802);
  add('metric', { name: 'recovery.count', value: 1 }, 1804);
  add('memory.written', { count: 2, kind: 'lesson', contentSnippet: 'two hard-won lessons from this run' }, 1810);
  add('task.status_changed', { from: 'verifying', to: 'delivering', reason: 'all steps verified' }, 1820);
  add('task.phase_changed', { phase: 'delivering' }, 1822);
  narrate('Done — five steps verified, one transient failure recovered. ', 1840);
  add('task.completed', {
    summary:
      'Added a `--json` flag to the camelia CLI and taught the acceptance report to emit machine-readable output. 5/5 steps verified, the workspace suite is 506/506 green, and one transient test failure was recovered automatically.',
    artifacts: [
      artifact('diff', 'packages/cli/src/main.ts', 'a91f', 210),
      artifact('diff', 'scripts/acceptance-report.ts', '7c02', 260),
      artifact('diff', 'tests/acceptance/cli.e2e.test.ts', '3fa1', 180),
      artifact('report', 'acceptance-report.json', 'c0de', 3140),
    ],
  }, 1860);

  return { beats, marks };
}

let cache: Script | undefined;
function script(): Script {
  cache ??= buildScript();
  return cache;
}

/** The event list for a scene — always the same for the same id. */
export function buildScenario(scene: SceneId): DomainEvent[] {
  const { beats, marks } = script();
  switch (scene) {
    case 'empty':
      return [];
    case 'planning':
      return beats.slice(0, marks.planning ?? 0);
    case 'plan':
      return beats.slice(0, marks.plan ?? 0);
    case 'diff':
      return beats.slice(0, marks.diff ?? 0);
    case 'running':
      return beats.slice(0, marks.running ?? 0);
    case 'approval':
      return beats.slice(0, marks.approval ?? 0);
    case 'failure':
      return beats.slice(0, marks.failure ?? 0);
    case 'error':
      // The transport refuses to start, so there is no replay at all — only the error state.
      return [];
    case 'connecting':
      // Bootstrap has landed but the engine has not answered — the stream stays empty.
      return [];
    case 'done':
      return beats.slice();
  }
}

/** Whether the scene's engine should still be considered connected after replay. */
export function sceneStatus(scene: SceneId): 'connecting' | 'offline' | 'live' | 'finished' {
  if (scene === 'connecting') return 'connecting';
  if (scene === 'empty' || scene === 'error') return 'offline';
  if (scene === 'done') return 'finished';
  return 'live';
}

export function isSceneId(value: string | null): value is SceneId {
  return SCENES.some((s) => s.id === value);
}