/**
 * SQLite schema and migrations.
 *
 * Uses `PRAGMA user_version` for forward-only migrations (whitepaper §7).
 * @module
 */

import type BetterSqlite3 from 'better-sqlite3';

export const SCHEMA_VERSION = 5;

/** V1 DDL — exported so tests can build a legacy database and exercise the V1→V2 migration. */
export const V1_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  workspace   TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  intent_raw        TEXT NOT NULL,
  intent_clarified  TEXT,
  status            TEXT NOT NULL,
  phase             TEXT NOT NULL,
  plan_json         TEXT,
  progress          REAL NOT NULL DEFAULT 0,
  resume_target     TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);

CREATE TABLE IF NOT EXISTS steps (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  title           TEXT NOT NULL,
  goal            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL,
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  weight          REAL NOT NULL DEFAULT 1,
  deps_json       TEXT NOT NULL DEFAULT '[]',
  started_at      INTEGER,
  ended_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_steps_task ON steps(task_id, idx);

CREATE TABLE IF NOT EXISTS tool_calls (
  id           TEXT PRIMARY KEY,
  step_id      TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  task_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  input_json   TEXT NOT NULL,
  output_json  TEXT,
  status       TEXT NOT NULL,
  risk         TEXT NOT NULL,
  reversible   INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER,
  error        TEXT,
  trace_id     TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_step ON tool_calls(step_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  name        TEXT,
  tokens      INTEGER NOT NULL DEFAULT 0,
  compacted   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, created_at);

CREATE TABLE IF NOT EXISTS verdicts (
  id            TEXT PRIMARY KEY,
  step_id       TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL,
  status        TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  reason        TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verdicts_task ON verdicts(task_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_idx      INTEGER NOT NULL,
  ctx_summary   TEXT NOT NULL DEFAULT '',
  fs_manifest   TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id, step_idx);

CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  session_id  TEXT,
  kind        TEXT NOT NULL,
  content     TEXT NOT NULL,
  keywords    TEXT NOT NULL DEFAULT '',
  embedding   BLOB,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, session_id);

CREATE TABLE IF NOT EXISTS events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  task_id     TEXT,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  trace_id    TEXT NOT NULL,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, seq);

CREATE TABLE IF NOT EXISTS metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT,
  name        TEXT NOT NULL,
  value       REAL NOT NULL,
  count       INTEGER NOT NULL DEFAULT 1,
  tags_json   TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
`;

/**
 * Iteration 20 — human-like memory lifecycle.
 *
 * Adds the lifecycle fields to `memories` (strength / importance / lastHitAt /
 * ttl / hits / nextReviewAt / retrievable / correctness / layer) and the
 * forgetting audit trail. Old rows are preserved: every new column gets a
 * sensible default, and `layer` is back-filled from the existing scope
 * (`global` → `long`, `session` → `short`) so nothing needs to be re-learned.
 */
const V2 = `
ALTER TABLE memories ADD COLUMN strength REAL NOT NULL DEFAULT 0.5;
ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5;
ALTER TABLE memories ADD COLUMN last_hit_at INTEGER;
ALTER TABLE memories ADD COLUMN ttl INTEGER;
ALTER TABLE memories ADD COLUMN hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN next_review_at INTEGER;
ALTER TABLE memories ADD COLUMN retrievable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN correctness REAL NOT NULL DEFAULT 0.5;
ALTER TABLE memories ADD COLUMN layer TEXT NOT NULL DEFAULT 'short';
UPDATE memories SET layer = 'long' WHERE scope = 'global' AND layer = 'short';

CREATE TABLE IF NOT EXISTS memory_forget_log (
  id              TEXT PRIMARY KEY,
  memory_id       TEXT NOT NULL,
  content_snippet TEXT NOT NULL DEFAULT '',
  reason          TEXT NOT NULL,
  value           REAL NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forget_log_memory ON memory_forget_log(memory_id, created_at);
`;

/**
 * Iteration 22 — evidence-backed correctness.
 *
 * Adds `evidence_json` (the verification that raised correctness to 1) to
 * `memories`. Nullable: pre-existing rows simply have no recorded evidence.
 */
const V3 = `
ALTER TABLE memories ADD COLUMN evidence_json TEXT;
`;

/**
 * Iteration 23 — failure-mode registry.
 *
 * A new table. Existing v3 rows stay readable; this migration only adds the table.
 */
const V4 = `
CREATE TABLE IF NOT EXISTS failure_modes (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  mechanism   TEXT NOT NULL,
  workspace   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_failure_modes_workspace ON failure_modes(workspace, kind);
`;

const V5 = `
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'work';
`;

/** Apply pending migrations. Idempotent and forward-only. */
export function migrate(db: BetterSqlite3.Database): number {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (current >= SCHEMA_VERSION) return current;
  if (current < 1) {
    db.exec(V1_SCHEMA);
    db.pragma(`user_version = 1`);
  }
  if (current < 2) {
    db.exec(V2);
    db.pragma(`user_version = 2`);
  }
  if (current < 3) {
    db.exec(V3);
    db.pragma(`user_version = 3`);
  }
  if (current < 4) {
    db.exec(V4);
    db.pragma(`user_version = 4`);
  }
  if (current < 5) {
    db.exec(V5);
    db.pragma(`user_version = 5`);
  }
  return Number(db.pragma('user_version', { simple: true }) ?? SCHEMA_VERSION);
}