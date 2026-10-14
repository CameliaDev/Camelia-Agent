#!/usr/bin/env node
/**
 * Offline cognition backtest (ARCH-COGNITION Phase 0).
 *
 *   pnpm cognition:backtest
 *   pnpm cognition:backtest --events events.json
 *   pnpm cognition:backtest --db ~/.camelia/camelia.db --out docs/COGNITION-PHASE0-REPORT.md
 *
 * `--db` opens the sqlite file read-only and reads `events`. It does not migrate
 * the database. With no input, the script replays the synthetic corpus and says so.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  formatBacktestReport,
  runCognitionBacktest,
  syntheticCognitionCorpus,
  type ReplayEvent,
} from '../src/cognition/index.js';

interface SqliteRow {
  seq: number;
  session_id: string | null;
  task_id: string | null;
  type: string;
  payload: string;
  trace_id: string;
  ts: number;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function loadJson(file: string): ReplayEvent[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${file} must be a JSON array of events`);
  return raw as ReplayEvent[];
}

async function loadSqlite(file: string): Promise<ReplayEvent[]> {
  // Node 22's built-in sqlite. Read-only so a backtest cannot migrate a user DB.
  const sqlite = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (filename: string, options: { readOnly: boolean }) => {
      prepare(sql: string): { all: () => SqliteRow[] };
      close: () => void;
    };
  };
  const db = new sqlite.DatabaseSync(path.resolve(file), { readOnly: true });
  try {
    const rows = db.prepare(
      'SELECT seq, session_id, task_id, type, payload, trace_id, ts FROM events ORDER BY seq ASC',
    ).all();
    return rows.map((row) => ({
      seq: row.seq,
      sessionId: row.session_id ?? undefined,
      taskId: row.task_id ?? undefined,
      type: row.type,
      payload: parsePayload(row.payload),
      traceId: row.trace_id,
      ts: row.ts,
    }));
  } finally {
    db.close();
  }
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return { raw: payload };
  }
}

async function main(): Promise<void> {
  const eventsFile = arg('--events');
  const dbFile = arg('--db');
  const outFile = arg('--out');
  let events: ReplayEvent[];
  let sourceLabel: string;
  if (eventsFile) {
    events = loadJson(eventsFile);
    sourceLabel = `JSON ${eventsFile} (${events.length} events)`;
  } else if (dbFile) {
    events = await loadSqlite(dbFile);
    sourceLabel = `SQLite ${dbFile} events table, read-only (${events.length} events)`;
  } else {
    events = syntheticCognitionCorpus();
    sourceLabel =
      'SIMULATED DomainEvent corpus (packages/harness/src/cognition/synthetic-corpus.ts). No user events table was passed. Outcomes are a fixed function of capability and archetype, using the real event names.';
  }
  const report = runCognitionBacktest(events, { sourceLabel });
  const text = formatBacktestReport(report);
  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(outFile, text);
  }
  process.stdout.write(text);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
