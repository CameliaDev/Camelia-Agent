/**
 * `camelia replay [taskId]` — read the durable event log back.
 *
 * Every cross-layer interaction is an event (whitepaper §2.3), so the SQLite event
 * log is a complete, ordered account of what the agent did. Replay is what turns
 * "the agent said it finished" into "here is every tool call, in order, with its
 * output" — the audit surface Claude Code does not expose as a first-class command.
 * @module
 */

import { SqliteSessionStore, type StoredEvent } from '@camelia/core';
import { paths } from '@camelia/agent';

import { option, type ParsedArgs } from '../args.js';
import { createTheme, resolveColour } from '../theme.js';
import { EXIT } from './run.js';

export async function replayCommand(args: ParsedArgs): Promise<number> {
  const colour = resolveColour(args.flags.has('no-color') ? 'never' : args.flags.has('color') ? 'always' : 'auto');
  const theme = createTheme(colour);
  const out = (text: string): void => void process.stdout.write(text);

  const dbFile = option(args, 'db', paths.database())!;
  const taskId = args.positionals[1];
  const json = args.flags.has('json');

  const store = new SqliteSessionStore(dbFile);
  try {
    if (!taskId) {
      const sessions = await store.listSessions(10);
      if (sessions.length === 0) {
        out(`\n${theme.dim('  no sessions recorded yet — run a task first.')}\n\n`);
        return EXIT.done;
      }
      out(`\n${theme.accentBold('Recent sessions')}\n\n`);
      for (const session of sessions) {
        const tasks = await store.listTasks(session.id);
        out(`  ${theme.text(session.id)}  ${theme.grey(session.workspace)}\n`);
        for (const task of tasks.slice(-8)) {
          out(`    ${theme.dim(task.status.padEnd(10))} ${theme.grey(task.id)}  ${theme.dim(task.intentRaw.slice(0, 80))}\n`);
        }
      }
      out('\n' + theme.dim('  replay one with: camelia replay <taskId>') + '\n\n');
      return EXIT.done;
    }

    const events = await store.listEvents({ taskId, limit: 5_000 });
    if (events.length === 0) {
      out(`\n${theme.red(`  no events for task ${taskId}`)}\n\n`);
      return EXIT.failed;
    }

    if (json) {
      out(`${JSON.stringify(events, null, 2)}\n`);
      return EXIT.done;
    }

    out(`\n${theme.accentBold('Replay')} ${theme.dim(taskId)} ${theme.dim(`${'\u00b7'} ${events.length} event(s)`)}\n\n`);
    for (const event of events) {
      out(`  ${theme.dim(relativeTime(event.ts))}  ${padType(event)} ${theme.text(event.type)} ${theme.grey(summarise(event))}\n`);
    }
    out('\n');
    return EXIT.done;
  } finally {
    store.close();
  }
}

function padType(event: StoredEvent): string {
  const kind = event.type.split('.')[0] ?? '';
  return kind.padEnd(12);
}

function relativeTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

/** One-line, type-aware summary of an event payload. */
function summarise(event: StoredEvent): string {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const parts: string[] = [];

  const step = record['step'];
  if (step && typeof step === 'object') {
    const s = step as Record<string, unknown>;
    if (typeof s['title'] === 'string') parts.push(String(s['title']).slice(0, 60));
  }
  const call = record['call'];
  if (call && typeof call === 'object') {
    const c = call as Record<string, unknown>;
    if (typeof c['name'] === 'string') parts.push(String(c['name']));
    if (typeof c['durationMs'] === 'number') parts.push(`${c['durationMs']}ms`);
  }
  const verdict = record['verdict'];
  if (verdict && typeof verdict === 'object') {
    const v = verdict as Record<string, unknown>;
    if (typeof v['status'] === 'string') parts.push(String(v['status']));
    if (typeof v['reason'] === 'string') parts.push(String(v['reason']).slice(0, 60));
  }
  if (typeof record['reason'] === 'string') parts.push(String(record['reason']).slice(0, 80));
  if (typeof record['to'] === 'string' && typeof record['from'] === 'string') {
    parts.push(`${record['from']} \u2192 ${record['to']}`);
  }
  if (typeof record['progress'] === 'number') parts.push(`${Math.round(record['progress'] * 100)}%`);

  return parts.join('  ').slice(0, 120);
}