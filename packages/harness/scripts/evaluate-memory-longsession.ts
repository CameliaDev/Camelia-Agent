/**
 * Iteration 26 · Stage 3 — promote threshold / recall_noise evaluation.
 *
 * DATA SOURCE (explicit): the real long-session hit data is NOT available —
 * the only real store on this machine (`~/.camelia/camelia.db`) holds 29
 * `memory.recalled` events, every one empty (`count:0, ids:[], noise:0`), zero
 * `memory.downgraded`, zero forget entries. So this run follows the taskbook's
 * option (b): a DETERMINISTIC SCRIPTED long session, clearly labelled as
 * simulated, that fixes the behaviour of the REAL engine code paths
 * (`MemoryService.recall` → `memory.recalled` events → `markIncorrect` →
 * `memory.downgraded`, `MemoryService.promoteShortTerm`,
 * `computeRecallNoiseAggregate`, `MemoryService.recallNoiseAggregate`) on real
 * store events, wired exactly like the real runtime (bus onEmit → appendEvent).
 *
 * Run (from repo root): pnpm --filter @camelia/harness exec tsx scripts/evaluate-memory-longsession.ts
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EventBus,
  InMemoryMetrics,
  InMemoryTracer,
  newId,
  type DomainEvent,
  type Id,
  type MemoryItem,
  type StoredEvent,
} from '@camelia/core';

import { MemoryService } from '../src/memory/MemoryService.js';
import { computeRecallNoiseAggregate } from '../src/memory/recallNoise.js';
import { FakeClock, MemoryStore, RecordingLogger } from '../test/helpers/context.js';

const SESSION_ID = newId();
const TASK_ID = newId();
const START_TS = 1_700_000_000_000;
const ROUND_MS = 60_000;

interface Sim {
  store: MemoryStore;
  service: MemoryService;
  clock: FakeClock;
}

function makeSim(): Sim {
  const store = new MemoryStore();
  const clock = new FakeClock(START_TS);
  // Persist every emitted event into the store, exactly like the real runtime's
  // bus wiring (CameliaRuntime onEmit → store.appendEvent). `seq` is assigned
  // by the store's appendEvent.
  const bus = new EventBus({
    onEmit: (event) => {
      const stored: StoredEvent = {
        type: event.type,
        payload: event.payload,
        traceId: event.traceId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        ts: event.ts,
        seq: 0,
      };
      void store.appendEvent(SESSION_ID, stored).catch(() => undefined);
    },
  });
  const service = new MemoryService({
    store,
    bus,
    logger: new RecordingLogger(),
    metrics: new InMemoryMetrics(),
    clock,
    budget: 1_000,
    halfLifeMs: 24 * 60 * 60 * 1_000,
    meta: { traceId: 'trace-eval', sessionId: SESSION_ID, taskId: TASK_ID },
  });
  return { store, service, clock };
}

/** Deterministic importance ladder — one short memory written per round. */
const IMPORTANCE_LADDER = [0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
const ROUNDS = 49; // 7 × 7: the importance cycle lands evenly

async function writeShortMemory(sim: Sim, id: Id, importance: number, content: string): Promise<void> {
  await sim.store.writeMemory({
    id,
    scope: 'session',
    sessionId: SESSION_ID,
    kind: 'fact',
    content,
    keywords: `zz${id}zz`, // single, unique token — the tokenizer keeps it whole
    importance,
    correctness: 0.5,
    layer: 'short',
    hits: 0,
    createdAt: sim.clock.now(),
    updatedAt: sim.clock.now(),
  } satisfies MemoryItem);
}

/**
 * Deterministic long session: 49 rounds × (write 1 short memory + 2 recalls +
 * every 4th round correct one recalled memory). Recalls go through the real
 * `service.recall()` so hits, noise and provenance are produced by the engine
 * code itself; distract tokens give a deterministic noise ladder. Memory ids are
 * alphanumeric only (`sim0` … `sim48`) so the keyword token is unique and never
 * splits.
 */
async function runLongSession(sim: Sim): Promise<void> {
  const written: Id[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    sim.clock.advance(ROUND_MS);
    const id = `sim${round}`;
    await writeShortMemory(sim, id, IMPORTANCE_LADDER[round % IMPORTANCE_LADDER.length]!, `simulated fact ${round} — deterministic long-session item`);
    written.push(id);

    // Deterministic noise ladder: d extra tokens that match nothing → noise d/(d+1).
    const distractCount = round % 6;
    const distract = Array.from({ length: distractCount }, (_, k) => ` dm${k}`).join('');

    // Recall the newest memory.
    await sim.service.recall({ text: `zz${id}zz${distract}` });

    // Recall one older memory (deterministic pick).
    const older = written[Math.max(0, (round * 5) % written.length)]!;
    if (older !== id) await sim.service.recall({ text: `zz${older}zz${distract}` });

    // Every 4th round the user corrects the older recalled memory → downgraded.
    if (round % 4 === 3 && older !== id) {
      await sim.service.markIncorrect(older, 'user-correction');
    }
  }
}

async function main(): Promise<void> {
  console.log('DATA SOURCE: SIMULATED (taskbook option b). Real long-session hit data is not available:');
  const realDb = path.join(os.homedir(), '.camelia', 'camelia.db');
  if (fs.existsSync(realDb)) {
    console.log(`  ${realDb} exists but its memory.recalled events are all empty (count:0), 0 downgrades, 0 forgets.`);
  } else {
    console.log(`  no real store at ${realDb}.`);
  }
  console.log('  Everything below is a deterministic scripted 49-round session driving the REAL MemoryService /');
  console.log('  computeRecallNoiseAggregate code on real store events. NOT real user data.\n');

  // ---- threshold sensitivity: three independent runs over the same scripted pool ----
  const sensitivity: { threshold: number; shortPool: number; promoted: number; rate: number }[] = [];
  let defaultSim: Sim | undefined;
  for (const threshold of [0.5, 0.6, 0.7]) {
    const sim = makeSim();
    await runLongSession(sim);
    // Pool measured BEFORE promotion (promoteShortTerm moves items out of 'short').
    const shortPool = (await sim.store.listAllMemories()).filter((m) => m.layer === 'short').length;
    const promoted = await sim.service.promoteShortTerm(threshold);
    sensitivity.push({ threshold, shortPool, promoted: promoted.length, rate: promoted.length / shortPool });
    if (threshold === 0.6) defaultSim = sim;
  }

  console.log('### 1 · promoteShortTermThreshold sensitivity (same simulated pool of 49 short memories)');
  console.log('| threshold | short pool | promoted | promotion rate |');
  console.log('| --- | --- | --- | --- |');
  for (const row of sensitivity) {
    console.log(`| ${row.threshold} | ${row.shortPool} | ${row.promoted} | ${(row.rate * 100).toFixed(1)}% |`);
  }
  console.log('');
  console.log('Observation: promotion is a pure importance gate (importance >= threshold); downgraded memories are');
  console.log('still promotable because promoteShortTerm only reads importance. Correctness feeds the value formula,');
  console.log('which drives recall — not the session-lifecycle promotion.\n');

  // ---- noise trend over the session (same pure function, windowed) ------------
  // Events carry the real clock's ts (the bus stamps Date.now()), so windows are
  // taken by recall-event count instead: each round emits exactly two
  // `memory.recalled` events (in append order, downgrades interleaved).
  const sim = defaultSim!;
  const events = sim.store.events;
  const prefixThroughRecall = (recallIndex: number): StoredEvent[] => {
    let seen = 0;
    const end = events.findIndex((e) => {
      if (e.type === 'memory.recalled') seen += 1;
      return seen >= recallIndex;
    });
    return end >= 0 ? events.slice(0, end + 1) : events;
  };
  console.log('### 2 · recall_noise trend as the session progresses (口径: downgradedHits / totalHits)');
  console.log('| after rounds | events | totalHits | downgradedHits | noiseRate |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const rounds of [12, 24, 36, 49]) {
    const prefix = prefixThroughRecall(rounds * 2);
    const agg = computeRecallNoiseAggregate(prefix);
    console.log(`| ${rounds} | ${prefix.length} | ${agg.totalHits} | ${agg.downgradedHits} | ${(agg.noiseRate * 100).toFixed(1)}% |`);
  }
  console.log('');
  const serviceAgg = await sim.service.recallNoiseAggregate();
  console.log(`cross-check service.recallNoiseAggregate() over the full log: totalHits=${serviceAgg.totalHits} downgradedHits=${serviceAgg.downgradedHits} noiseRate=${(serviceAgg.noiseRate * 100).toFixed(1)}% downgradedMemories=${serviceAgg.downgradedMemories}`);
  console.log(`memories at session end: ${(await sim.store.listAllMemories()).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
