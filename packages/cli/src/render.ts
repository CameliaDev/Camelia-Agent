/**
 * Event renderer — projects the task state machine onto the terminal.
 *
 * This is the CLI's half of whitepaper §6: *the UI is a projection of task state,
 * not a shell around it.* The renderer subscribes to the bus and nothing else — it
 * holds no state that the backend does not already own, so what the user reads is
 * the real lifecycle, not a spinner with a story attached.
 *
 * It answers, for every step, the four questions the architecture checklist asks
 * (whitepaper §5): which phase are we in, which step, did the tool succeed, and is
 * the result verified.
 * @module
 */

import type { DomainEvent, EventBus, Unsubscribe } from '@camelia/core';

import type { Theme } from './theme.js';

export interface RendererOptions {
  theme: Theme;
  write?: (line: string) => void;
  /** Suppress per-step progress; keep only the final outcome and failures. */
  quiet?: boolean;
  /** Add planning, context and verification detail. */
  verbose?: boolean;
}

const SYMBOL = {
  step: '\u25b8', // ▸
  done: '\u2713', // ✓
  fail: '\u2717', // ✗
  warn: '\u0021', // !
  tool: '\u2022', // •
  arrow: '\u2192', // →
  bullet: '\u00b7', // ·
} as const;

export class EventRenderer {
  private readonly write: (line: string) => void;
  private readonly theme: Theme;
  private readonly quiet: boolean;
  private readonly verbose: boolean;
  private lastPhase?: string;

  constructor(
    private readonly bus: EventBus,
    options: RendererOptions,
  ) {
    this.theme = options.theme;
    this.write = options.write ?? ((line) => process.stdout.write(line));
    this.quiet = options.quiet ?? false;
    this.verbose = options.verbose ?? false;
  }

  /** Subscribe to every event. Returns the unsubscribe handle. */
  attach(): Unsubscribe {
    return this.bus.onAny((event) => this.render(event));
  }

  private line(text = ''): void {
    this.write(`${text}\n`);
  }

  private render(event: DomainEvent): void {
    if (this.quiet && !isOutcomeEvent(event.type)) return;

    switch (event.type) {
      case 'task.phase_changed': {
        const { phase } = event.payload;
        if (phase === this.lastPhase) return;
        this.lastPhase = phase;
        if (phase === 'idle') return;
        this.line(`${this.theme.accent('\u25d0')} ${this.theme.accentBold(phase)}`);
        return;
      }

      case 'task.status_changed': {
        if (!this.verbose) return;
        const { from, to, reason } = event.payload;
        this.line(this.theme.dim(`  ${from} ${SYMBOL.arrow} ${to}  (${reason})`));
        return;
      }

      case 'provider.selected': {
        if (this.quiet) return;
        const { providerId, model, reason } = event.payload;
        this.line(this.theme.dim(`  provider ${this.theme.grey(providerId)} ${SYMBOL.bullet} model ${this.theme.grey(model)}`));
        if (this.verbose) this.line(this.theme.dim(`    ${reason}`));
        return;
      }

      case 'provider.fallback': {
        const { from, to, reason } = event.payload;
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber(`fallback ${from} ${SYMBOL.arrow} ${to}`)} ${this.theme.dim(`(${reason})`)}`);
        return;
      }

      case 'plan.ready': {
        if (this.quiet) return;
        const steps = event.payload.plan.steps;
        this.line(`  ${this.theme.bold(`plan`)} ${this.theme.dim(`${SYMBOL.bullet} ${steps.length} step${steps.length === 1 ? '' : 's'}`)}`);
        for (const step of steps) {
          this.line(`    ${this.theme.dim(String(step.idx + 1).padStart(2, ' '))}. ${this.theme.text(step.title)}`);
        }
        return;
      }

      case 'plan.revised': {
        const { plan, reason } = event.payload;
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber(`replanned`)} ${this.theme.dim(`(${reason.slice(0, 120)})`)} ${this.theme.dim(`${SYMBOL.arrow} ${plan.steps.length} steps`)}`);
        return;
      }

      case 'step.started': {
        if (this.quiet) return;
        const { step } = event.payload;
        this.line(`  ${this.theme.accent(SYMBOL.step)} ${this.theme.text(step.title)}`);
        return;
      }

      case 'step.completed': {
        if (this.quiet) return;
        const { step, result } = event.payload;
        this.line(`    ${this.theme.green(SYMBOL.done)} ${this.theme.green('step done')} ${this.theme.dim(`step ${step.idx + 1}`)}`);
        if (this.verbose && result.summary) {
          this.line(this.theme.dim(`      ${firstLine(result.summary).slice(0, 160)}`));
        }
        return;
      }

      case 'step.failed': {
        const { step, error } = event.payload;
        this.line(`    ${this.theme.red(SYMBOL.fail)} ${this.theme.red('step failed')} ${this.theme.dim(`step ${step.idx + 1}`)} ${this.theme.red(error.slice(0, 200))}`);
        return;
      }

      case 'tool.approval_required': {
        const { call } = event.payload;
        this.line(`    ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber(`approval required`)} ${this.theme.text(call.name)} ${this.theme.dim(`(${call.risk})`)}`);
        return;
      }

      case 'tool.denied': {
        const { reason } = event.payload;
        this.line(`    ${this.theme.red(SYMBOL.fail)} ${this.theme.red('denied')} ${this.theme.dim(reason)}`);
        return;
      }

      case 'tool.finished': {
        if (this.quiet) return;
        const { call } = event.payload;
        const ms = call.durationMs ?? 0;
        const status = call.status === 'ok' ? this.theme.green(SYMBOL.done) : this.theme.red(SYMBOL.fail);
        const detail = describeTool(call.name, call.input);
        this.line(`    ${this.theme.dim(SYMBOL.tool)} ${this.theme.grey(call.name)}${detail ? this.theme.dim(`(${detail})`) : ''} ${status} ${this.theme.dim(`${ms}ms`)}`);
        return;
      }

      case 'tool.failed': {
        const { name, error } = event.payload;
        this.line(`    ${this.theme.red(SYMBOL.fail)} ${this.theme.red(name)} ${this.theme.dim(error.slice(0, 200))}`);
        return;
      }

      case 'verify.result': {
        const { verdict } = event.payload;
        if (verdict.status === 'pass') {
          if (!this.verbose) return;
          this.line(`    ${this.theme.green(SYMBOL.done)} ${this.theme.green('verified')} ${this.theme.dim(`${verdict.evidence.length} check(s)`)}`);
          return;
        }
        if (verdict.status === 'unknown') {
          this.line(`    ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber('unverified')} ${this.theme.dim(verdict.reason.slice(0, 160))}`);
          return;
        }
        this.line(`    ${this.theme.red(SYMBOL.fail)} ${this.theme.red('verification failed')} ${this.theme.dim(verdict.reason.slice(0, 200))}`);
        return;
      }

      case 'context.compacted': {
        const { tokensBefore, tokensAfter, droppedMessages, summaries } = event.payload;
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber('context compacted')} ${this.theme.dim(`${tokensBefore} ${SYMBOL.arrow} ${tokensAfter} tokens, dropped ${droppedMessages}`)}`);
        for (const summary of summaries.slice(0, 3)) {
          this.line(this.theme.dim(`      ${summary.slice(0, 160)}`));
        }
        return;
      }

      case 'reliability.drift_detected': {
        const { score, signals } = event.payload;
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber('drift detected')} ${this.theme.dim(`score ${score.toFixed(2)} ${SYMBOL.bullet} ${signals.join(', ')}`)}`);
        return;
      }

      case 'reliability.loop_detected': {
        const { repeats, action } = event.payload;
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber('loop detected')} ${this.theme.dim(`repeated ${repeats}x ${SYMBOL.bullet} ${action}`)}`);
        return;
      }

      case 'reliability.no_progress': {
        const { streak, action } = event.payload;
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber('no progress')} ${this.theme.dim(`${streak} steps ${SYMBOL.bullet} ${action}`)}`);
        return;
      }

      case 'reliability.hallucination_blocked': {
        const { claim, reason } = event.payload;
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber('unverified claim blocked')} ${this.theme.dim(`${claim.slice(0, 100)} ${SYMBOL.bullet} ${reason}`)}`);
        return;
      }

      case 'recovery.attempted': {
        const { strategy, attempt } = event.payload;
        this.line(`  ${this.theme.dim(`${SYMBOL.bullet} recovery ${strategy} (attempt ${attempt})`)}`);
        return;
      }

      case 'recovery.rollback_started': {
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber('rolling back workspace')}`);
        return;
      }

      case 'recovery.rollback_done': {
        const { restored } = event.payload;
        this.line(`  ${this.theme.dim(`${SYMBOL.done} rollback restored ${restored} file(s)`)}`);
        return;
      }

      case 'checkpoint.created': {
        if (!this.verbose) return;
        const { checkpoint } = event.payload;
        this.line(this.theme.dim(`    checkpoint before step ${checkpoint.stepIdx + 1}`));
        return;
      }

      case 'task.paused': {
        this.line(`  ${this.theme.amber(SYMBOL.warn)} ${this.theme.amber('paused')} ${this.theme.dim(event.payload.reason)}`);
        return;
      }

      case 'task.cancelled': {
        this.line(`  ${this.theme.red(SYMBOL.fail)} ${this.theme.red('cancelled')} ${this.theme.dim(event.payload.reason)}`);
        return;
      }

      case 'task.failed': {
        this.line(`  ${this.theme.red(SYMBOL.fail)} ${this.theme.red('failed')} ${this.theme.dim(event.payload.reason.slice(0, 240))}`);
        return;
      }

      case 'subagent.spawned': {
        this.line(`  ${this.theme.dim(`${SYMBOL.bullet} sub-agent: ${event.payload.goal.slice(0, 120)}`)}`);
        return;
      }

      case 'work.delegated': {
        this.line(this.theme.dim(`  sub-AIs ${event.payload.workers}, handed back ${event.payload.handedBack}`));
        return;
      }

      case 'work.plan_saved': {
        this.line(this.theme.dim(`  saved ${event.payload.mode}: ${event.payload.title}`));
        return;
      }

      case 'log': {
        if (!this.verbose) return;
        const { level, message } = event.payload;
        this.line(this.theme.dim(`    [${level}] ${message}`));
        return;
      }

      default:
        return;
    }
  }
}

function isOutcomeEvent(type: DomainEvent['type']): boolean {
  return type === 'task.completed' || type === 'task.failed' || type === 'task.cancelled';
}

/** One-line description of a tool call's salient argument. */
function describeTool(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const path = record['path'];
  if (typeof path === 'string') return path;
  const command = record['command'];
  if (typeof command === 'string') return command.length > 80 ? `${command.slice(0, 80)}\u2026` : command;
  const pattern = record['pattern'];
  if (typeof pattern === 'string') return pattern;
  return '';
}

function firstLine(text: string): string {
  const idx = text.indexOf('\n');
  return idx === -1 ? text : text.slice(0, idx);
}