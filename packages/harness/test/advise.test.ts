/**
 * Phase 4 advise path — pure pieces and the session that composes them.
 *
 * The loop is not involved. Tickets are decisions, not executions.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DAILY_EXPLORATION_BUDGET,
  UNKNOWN_ACTION_FALLBACK,
} from '@camelia/core';

import {
  EnvironmentLedger,
  checkEnvironment,
  classifyAdviseError,
  createAdviseSession,
  createGate,
  criticalDiff,
  defaultHeuristicTable,
  manualLower,
  manualRaise,
  noteStructuredMismatch,
  noteSuccess,
  parseHeuristicTable,
  readShippedHeuristicFile,
  routeA,
  routeB,
  sealErrorClass,
  translate,
  validateRollback,
  validateTranslated,
  type AdviseInput,
} from '../src/cognition/advise/index.js';

const DAY = Date.parse('2026-10-14T03:00:00.000Z');
const NEXT_DAY = Date.parse('2026-10-15T03:00:00.000Z');
const SIG = ['tool-calling', 'edit', 'single-file', 'deg0', 'tools0'];

function input(over: Partial<AdviseInput> = {}): AdviseInput {
  return {
    now: DAY,
    errorClass: 'test',
    verifierId: 'ver-1',
    expected: { status: 'pass' },
    actual: { status: 'fail', at: 1, traceId: 'noise' },
    signature: SIG,
    lastOutcome: 'failure',
    environmentHint: 'OK',
    rollback: { type: 'file_backup', id: 'bak-1' },
    sleep: async () => {},
    ...over,
  };
}

describe('critical diff', () => {
  it('ignores timestamps and random ids', () => {
    const diff = criticalDiff(
      { status: 'pass', at: 1, traceId: 'a', nested: { seed: 1, name: 'same' } },
      { status: 'pass', at: 9, traceId: 'b', nested: { seed: 2, name: 'same' } },
    );
    expect(diff.equal).toBe(true);
    expect(diff.changed).toEqual([]);
    expect(diff.ignored).toEqual(expect.arrayContaining(['at', 'traceId', 'nested.seed']));
  });

  it('reports a real status change and still ignores noise beside it', () => {
    const diff = criticalDiff({ status: 'pass', at: 1 }, { status: 'fail', at: 2 });
    expect(diff.equal).toBe(false);
    expect(diff.changed).toEqual(['status']);
    expect(diff.ignored).toEqual(['at']);
  });
});

describe('errorClass', () => {
  it('seals an invented class as unknown', () => {
    expect(sealErrorClass('cosmic_ray')).toBe('unknown');
    expect(sealErrorClass('test')).toBe('test');
  });

  it('classifies hard gates and lint without asking a model', () => {
    expect(classifyAdviseError('TS2345 type error', 'file-contains')).toBe('type');
    expect(classifyAdviseError('sandbox denied the write')).toBe('sandbox');
    expect(classifyAdviseError('eslint failed')).toBe('lint');
    expect(classifyAdviseError('missing file', 'test-pass')).toBe('test');
  });
});

describe('environment', () => {
  it('retries a timeout and records a status word, not the thrown source', async () => {
    const ledger = new EnvironmentLedger();
    let calls = 0;
    const checked = await checkEnvironment({
      errorClass: 'env',
      timeoutMs: 20,
      maxRetries: 2,
      now: () => DAY,
      ledger,
      sleep: async () => {},
      probe: async () => {
        calls += 1;
        if (calls === 1) throw new Error('const SECRET_SOURCE = 1');
        return 'OK';
      },
    });
    expect(checked.status).toBe('OK');
    expect(checked.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(JSON.stringify(checked.logs)).not.toContain('SECRET_SOURCE');
    expect(checked.logs.map((entry) => entry.note)).toEqual(['throw', 'ok']);
  });

  it('turns a hanging probe into UNKNOWN', async () => {
    const ledger = new EnvironmentLedger();
    const checked = await checkEnvironment({
      errorClass: 'env',
      timeoutMs: 15,
      maxRetries: 1,
      now: () => DAY,
      ledger,
      sleep: async () => {},
      probe: () => new Promise(() => {}),
    });
    expect(checked.status).toBe('UNKNOWN');
    expect(checked.timedOut).toBe(true);
    expect(checked.logs[0]?.note).toBe('timeout');
  });

  it('degrades the third consecutive UNKNOWN to FAIL', async () => {
    const ledger = new EnvironmentLedger();
    const statuses = [];
    for (let n = 0; n < 3; n += 1) {
      const checked = await checkEnvironment({
        errorClass: 'test',
        timeoutMs: 10,
        maxRetries: 1,
        now: () => DAY,
        ledger,
        sleep: async () => {},
        probe: async () => {
          throw new Error('timeout');
        },
      });
      statuses.push({ status: checked.status, degraded: checked.degraded });
    }
    expect(statuses).toEqual([
      { status: 'UNKNOWN', degraded: false },
      { status: 'UNKNOWN', degraded: false },
      { status: 'FAIL', degraded: true },
    ]);
  });

  it('archives logs older than seven days', () => {
    const ledger = new EnvironmentLedger();
    const old = DAY - 8 * 24 * 60 * 60 * 1000;
    ledger.push({ at: old, errorClass: 'env', status: 'FAIL', attempt: 1, timedOut: false, note: 'fail' });
    ledger.prune(DAY);
    expect(ledger.archived).toBe(1);
    expect(ledger.hotLogs(DAY)).toEqual([]);
  });
});

describe('heuristic table', () => {
  it('parses the shipped JSON and YAML as the same versioned table', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const json = readShippedHeuristicFile();
    const yaml = readFileSync(join(dir, '../src/cognition/advise/heuristics.v1.yaml'), 'utf8');
    const fromJson = parseHeuristicTable(json);
    const fromYaml = parseHeuristicTable(yaml);
    const embedded = parseHeuristicTable(readFileSync(join(dir, '../src/cognition/advise/heuristics.v1.json'), 'utf8'));
    expect(fromJson.ok && fromYaml.ok && embedded.ok).toBe(true);
    if (!fromJson.ok || !fromYaml.ok || !embedded.ok) return;
    expect(fromJson.table).toEqual(fromYaml.table);
    expect(fromJson.table).toEqual(embedded.table);
    expect(fromJson.table.heuristic_table_version).toBe('1.0.0');
    expect(defaultHeuristicTable().heuristic_table_version).toBe('1.0.0');
  });

  it('rejects a table with no version', () => {
    expect(parseHeuristicTable('{"rules":[]}')).toEqual({ ok: false, reason: 'version' });
  });
});

describe('router A', () => {
  const table = defaultHeuristicTable();

  it('returns table candidates when the environment is OK', () => {
    const routed = routeA({ errorClass: 'test', environment: 'OK', table });
    expect(routed.source).toBe('table');
    expect(routed.candidates).toEqual(['rerun_verifier', 'consult_docs', 'rollback']);
  });

  it('does not use OK-path rules when the environment failed', () => {
    const routed = routeA({ errorClass: 'test', environment: 'FAIL', table });
    expect(routed.source).toBe('environment-fail');
    expect(routed.candidates).toEqual(['repair_environment', 'escalate_human']);
  });

  it('falls back for an unknown class and never returns an empty list', () => {
    const routed = routeA({ errorClass: 'unknown', environment: 'OK', table });
    expect(routed.candidates).toEqual([...UNKNOWN_ACTION_FALLBACK]);
    expect(routed.source).toBe('unknown-fallback');
    expect(routed.candidates.length).toBeGreaterThan(0);
  });

  it('skips a disabled rule', () => {
    const parsed = parseHeuristicTable(`{
      "heuristic_table_version": "1.0.0",
      "rules": [
        {"id":"off","errorClass":"lint","environment":"OK","priority":50,"enabled":false,"candidates":["rollback"]},
        {"id":"on","errorClass":"lint","environment":"OK","priority":1,"enabled":true,"candidates":["consult_docs"]}
      ]
    }`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(routeA({ errorClass: 'lint', environment: 'OK', table: parsed.table }).candidates).toEqual(['consult_docs']);
  });
});

describe('router B', () => {
  const candidates = ['rollback', 'consult_docs'] as const;

  it('does not rank or add candidates below the current-version group of 20', () => {
    const ranked = routeB({
      errorClass: 'test',
      candidates,
      currentVersion: '1.0.0',
      samples: [
        { errorClass: 'test', actionId: 'consult_docs', heuristicTableVersion: '0.9.0', attempts: 100, successes: 100 },
        { errorClass: 'test', actionId: 'rollback', heuristicTableVersion: '1.0.0', attempts: 19, successes: 0 },
      ],
    });
    expect(ranked.ranked).toBe(false);
    expect(ranked.order).toEqual([...candidates]);
  });

  it('reorders once the current group is open and down-weights the old version', () => {
    const ranked = routeB({
      errorClass: 'test',
      candidates,
      currentVersion: '1.0.0',
      samples: [
        { errorClass: 'test', actionId: 'rollback', heuristicTableVersion: '1.0.0', attempts: 20, successes: 2 },
        { errorClass: 'test', actionId: 'consult_docs', heuristicTableVersion: '0.9.0', attempts: 20, successes: 20 },
        { errorClass: 'test', actionId: 'consult_docs', heuristicTableVersion: '1.0.0', attempts: 20, successes: 19 },
      ],
    });
    expect(ranked.ranked).toBe(true);
    expect(ranked.order).toEqual(['consult_docs', 'rollback']);
    expect(new Set(ranked.order)).toEqual(new Set(candidates));
  });

  it('does not grow a 100-sample group into a new candidate', () => {
    const ranked = routeB({
      errorClass: 'test',
      candidates,
      currentVersion: '1.0.0',
      samples: [{ errorClass: 'test', actionId: 'rollback', heuristicTableVersion: '1.0.0', attempts: 100, successes: 90 }],
    });
    expect(ranked.order).toHaveLength(candidates.length);
    expect(ranked.order).not.toContain('escalate_human');
  });
});

describe('translate schema v1.0', () => {
  const context = {
    errorClass: 'test' as const,
    verifierId: 'ver-1',
    action_id: 'rollback' as const,
    signature: SIG,
    lastOutcome: 'failure' as const,
  };

  it('accepts a capped context', () => {
    const result = translate({
      context,
      confidence: 0.5,
      rollback: { type: 'git_stash', id: 'stash@{0}' },
      humanGateLevel: 'L2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.human_gate_level).toBe('L2');
    expect(result.value.confidence).toBe(0.5);
  });

  it('rejects an invalid schema, extra context, and a short signature', () => {
    expect(translate({ context, confidence: 1.2, rollback: { type: 'git_stash', id: 's' }, humanGateLevel: 'L2' }).ok).toBe(false);
    expect(translate({ context: { ...context, signature: ['a', 'b'] }, confidence: 0.2, rollback: { type: 'git_stash', id: 's' }, humanGateLevel: 'L1' })).toMatchObject({
      ok: false,
      reason: 'context.signature',
    });
    expect(validateTranslated({ ...{
      action_id: 'rollback',
      prediction: 'test→rollback',
      confidence: 0.2,
      verifier_target: 'ver-1',
      rollback_point: { type: 'git_commit', id: 'abc' },
      human_gate_level: 'L2',
    } })).toMatchObject({ ok: false, reason: 'rollback.type' });
    const extra = { ...context, history: ['entire chat'] };
    expect(translate({ context: extra, confidence: 0.2, rollback: { type: 'git_stash', id: 's' }, humanGateLevel: 'L2' })).toMatchObject({
      ok: false,
      reason: 'context.extra',
    });
  });
});

describe('rollback validators', () => {
  const evidence = {
    gitStashes: ['stash@{0}'],
    readableFiles: ['backups/a.txt'],
    dockerSnapshots: ['snap-1'],
    openTransactions: ['tx-1'],
  };

  it('accepts each kind only when the evidence says it exists', () => {
    expect(validateRollback({ type: 'git_stash', id: 'stash@{0}' }, evidence)).toEqual({ ok: true });
    expect(validateRollback({ type: 'file_backup', id: 'backups/a.txt' }, evidence)).toEqual({ ok: true });
    expect(validateRollback({ type: 'docker_snapshot', id: 'snap-1' }, evidence)).toEqual({ ok: true });
    expect(validateRollback({ type: 'db_transaction', id: 'tx-1' }, evidence)).toEqual({ ok: true });
    expect(validateRollback({ type: 'git_stash', id: 'missing' }, evidence).ok).toBe(false);
    expect(validateRollback({ type: 'file_backup', id: 'missing' }, evidence).ok).toBe(false);
    expect(validateRollback({ type: 'docker_snapshot', id: 'missing' }, evidence).ok).toBe(false);
    expect(validateRollback({ type: 'db_transaction', id: 'closed' }, evidence).ok).toBe(false);
  });
});

describe('gates and trust window', () => {
  it('raises on the third mismatch of the same verifier and class, and ignores noise', () => {
    let state = createGate('L2');
    state = noteStructuredMismatch(state, 'ver-1', 'test', false).state;
    state = noteStructuredMismatch(state, 'ver-1', 'test', false).state;
    expect(state.level).toBe('L2');
    state = noteStructuredMismatch(state, 'ver-1', 'test', true).state;
    state = noteStructuredMismatch(state, 'ver-2', 'test', true).state;
    state = noteStructuredMismatch(state, 'ver-1', 'lint', true).state;
    expect(state.level).toBe('L2');
    state = noteStructuredMismatch(state, 'ver-1', 'test', true).state;
    const third = noteStructuredMismatch(state, 'ver-1', 'test', true);
    expect(third.raised).toBe(true);
    expect(third.state.level).toBe('L3');
    expect(third.state.raisesAuto).toBe(1);
  });

  it('pauses automatic lowering after a manual raise, and a manual lower clears the streak', () => {
    let state = createGate('L2');
    state = noteSuccess(state).state;
    state = noteSuccess(state).state;
    expect(state.successStreak).toBe(2);
    state = manualLower(state);
    expect(state.level).toBe('L1');
    expect(state.successStreak).toBe(0);
    expect(state.mode).toBe('auto');
    state = noteSuccess(state).state;
    state = noteSuccess(state).state;
    expect(state.level).toBe('L1');
    state = manualRaise(state);
    expect(state.mode).toBe('manual');
    expect(state.level).toBe('L2');
    for (let n = 0; n < 2; n += 1) state = noteSuccess(state).state;
    expect(state.mode).toBe('manual');
    expect(state.level).toBe('L2');
    const left = noteSuccess(state);
    expect(left.leftManual).toBe(true);
    expect(left.lowered).toBe(false);
    expect(left.state.level).toBe('L2');
    expect(left.state.successStreak).toBe(0);
  });
});

describe('AdviseSession', () => {
  it('holds a default L2 ticket for a human and does not write a skill', async () => {
    const session = createAdviseSession({ now: DAY });
    const outcome = await session.advise(input());
    expect(outcome.ticket.disposition).toBe('pending_human');
    expect(outcome.ticket.gate).toBe('L2');
    expect(outcome.ticket.skillWritten).toBe(false);
    expect(outcome.residual.hardGate).toBe('test');
    expect(outcome.metrics.health.gatePassRate).toBe(0);
    expect(outcome.metrics.diagnostic.routerHitsA).toBe(1);
    const committed = session.commitOutcome({ ticketId: outcome.ticket.id, success: false, now: DAY, signatureKey: 'k' });
    expect(committed.skill).toBeUndefined();
  });

  it('rejects a short signature and does not write a skill', async () => {
    const session = createAdviseSession({ now: DAY });
    const outcome = await session.advise(input({ signature: ['only', 'two'] }));
    expect(outcome.ticket.disposition).toBe('rejected');
    expect(outcome.ticket.rejectReason).toBe('context.signature');
    expect(outcome.metrics.diagnostic.translateRejectRate).toBe(1);
    expect(session.commitOutcome({ ticketId: outcome.ticket.id, success: true, now: DAY, signatureKey: 'k' }).skill).toBeUndefined();
  });

  it('authorizes at L0 only when the rollback point checks out, and stamps the table version', async () => {
    const session = createAdviseSession({ now: DAY, gate: 'L0' });
    const denied = await session.advise(input());
    expect(denied.ticket.disposition).toBe('rejected');
    expect(denied.ticket.rejectReason).toContain('rollback.missing');
    const allowed = await session.advise(input({
      evidence: { gitStashes: [], readableFiles: ['bak-1'], dockerSnapshots: [], openTransactions: [] },
    }));
    expect(allowed.ticket.disposition).toBe('authorized');
    const committed = session.commitOutcome({
      ticketId: allowed.ticket.id,
      success: true,
      now: DAY,
      signatureKey: 'tool-calling|edit|single-file|0',
    });
    expect(committed.skill?.heuristicTableVersion).toBe('1.0.0');
    expect(committed.skill?.successes).toBe(1);
    expect(committed.metrics.diagnostic.skillRecordsToday).toBe(1);
  });

  it('does not persist a skill when a lint success only clears the soft gate', async () => {
    const session = createAdviseSession({ now: DAY, gate: 'L0' });
    const outcome = await session.advise(input({
      errorClass: 'lint',
      evidence: { gitStashes: [], readableFiles: ['bak-1'], dockerSnapshots: [], openTransactions: [] },
    }));
    expect(outcome.ticket.disposition).toBe('authorized');
    expect(outcome.residual.hardGate).toBeNull();
    expect(outcome.residual.softGate).toBe('lint');
    const committed = session.commitOutcome({
      ticketId: outcome.ticket.id,
      success: true,
      now: DAY,
      signatureKey: 'k',
    });
    expect(committed.skill).toBeUndefined();
    expect(committed.metrics.diagnostic.skillRecordsToday).toBe(0);
  });

  it('isolates an exploration failure from the skill table and the raise counter', async () => {
    const session = createAdviseSession({ now: DAY, gate: 'L1' });
    const evidence = { gitStashes: [], readableFiles: ['bak-1'], dockerSnapshots: [], openTransactions: [] };
    const first = await session.advise(input({ evidence }));
    expect(first.ticket.explored).toBe(true);
    expect(first.ticket.disposition).toBe('authorized');
    expect(session.commitOutcome({
      ticketId: first.ticket.id,
      success: false,
      explorationFailed: true,
      now: DAY,
      signatureKey: 'k',
    }).skill).toBeUndefined();
    const second = await session.advise(input({ evidence }));
    expect(second.metrics.health.gateRaisesAuto).toBe(0);
    const third = await session.advise(input({ evidence }));
    expect(third.metrics.health.gateRaisesAuto).toBe(1);
    expect(third.metrics.trust.level).toBe('L2');
  });

  it('stops exploring after the global daily budget and resumes the next day', async () => {
    const session = createAdviseSession({ now: DAY, gate: 'L1' });
    for (let n = 0; n < DAILY_EXPLORATION_BUDGET; n += 1) {
      const outcome = await session.advise(input({ verifierId: `budget-${n}` }));
      expect(outcome.ticket.explored).toBe(true);
    }
    const blocked = await session.advise(input());
    expect(blocked.ticket.explored).toBe(false);
    const next = await session.advise(input({ now: NEXT_DAY }));
    expect(next.ticket.explored).toBe(true);
  });

  it('does not explore at L2', async () => {
    const session = createAdviseSession({ now: DAY, gate: 'L2' });
    const outcome = await session.advise(input());
    expect(outcome.ticket.explored).toBe(false);
    expect(outcome.ticket.disposition).toBe('pending_human');
  });

  it('maps an invented error class onto the unknown fallback', async () => {
    const session = createAdviseSession({ now: DAY });
    const outcome = await session.advise(input({ errorClass: 'cosmic_ray' }));
    expect(outcome.ticket.errorClass).toBe('unknown');
    expect(outcome.ticket.routerSource).toBe('unknown-fallback');
    expect(outcome.ticket.candidates).toEqual([...UNKNOWN_ACTION_FALLBACK]);
  });
});
