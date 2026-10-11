/**
 * Context manager — assembly, deduplication, priority and compaction.
 *
 * The core promise (whitepaper §4.5): compaction may drop conversation volume but
 * must never drop the goal, constraints, open todos or artifact paths. Those live
 * in *protected slots* that are re-rendered into the system message on every build.
 * @module
 */

import type { DroppedMessage, LLMMessage, LoggerPort, MetricsPort, TokenBudget } from '@camelia/core';
import { estimateTokens, withSafetyMargin } from '@camelia/core';

import type { HarnessConfig } from '../config.js';

/** Facts that survive every compaction. */
export interface ProtectedSlots {
  /** One-sentence goal, restated verbatim. */
  goal: string;
  constraints: string[];
  /** Open work items. */
  todos: string[];
  /** Artifact paths produced so far. */
  artifacts: string[];
}

export function emptySlots(): ProtectedSlots {
  return { goal: '', constraints: [], todos: [], artifacts: [] };
}

interface ContextEntry {
  id: string;
  message: LLMMessage;
  tokens: number;
  /** Pinned entries are never compaction victims. */
  pinned: boolean;
  /** True once this entry has been folded into a summary. */
  compacted: boolean;
}

export interface CompactionResult {
  performed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  dropped: number;
  summaries: string[];
  /** Bounded originals of the dropped messages, so the UI can show the raw text. */
  droppedPreviews: DroppedMessage[];
  /** Fraction of protected-slot items still present. 1 means nothing was lost. */
  retention: number;
}

export interface BuiltContext {
  messages: LLMMessage[];
  budget: TokenBudget;
  /** Human-readable log of what compaction removed, for the UI panel. */
  compactionLog: string[];
}

/** Pluggable summarizer. Default is deterministic and structural (no model call). */
export type Summarizer = (messages: LLMMessage[]) => Promise<string>;

/** Structural fallback summarizer: keeps role, tool name and a content prefix. */
export const structuralSummarizer: Summarizer = async (messages) => {
  const lines = messages.map((m) => {
    const label = m.role === 'tool' ? `tool:${m.name ?? '?'}` : m.role;
    const body = m.content.replace(/\s+/g, ' ').trim().slice(0, 160);
    return `- ${label}: ${body}`;
  });
  return `[compacted ${messages.length} earlier messages]\n${lines.join('\n')}`;
};

/** Caps that keep a compaction's dropped-original payload bounded in the event stream. */
const MAX_DROPPED_PREVIEWS = 12;
const MAX_PREVIEW_CHARS = 2_000;

/**
 * Build bounded originals of the messages about to be dropped.
 *
 * The most recent victims are kept — they are the ones a reader is most likely to want
 * back — while older ones beyond the cap are still counted but not carried. Content is
 * truncated per message so a single huge tool output cannot dominate the snapshot.
 */
export function previewDropped(messages: LLMMessage[]): DroppedMessage[] {
  const kept =
    messages.length > MAX_DROPPED_PREVIEWS ? messages.slice(messages.length - MAX_DROPPED_PREVIEWS) : messages;
  return kept.map((m) => {
    const truncated = m.content.length > MAX_PREVIEW_CHARS;
    const preview: DroppedMessage = {
      role: m.role,
      content: truncated ? m.content.slice(0, MAX_PREVIEW_CHARS) : m.content,
      truncated,
    };
    if (m.name) preview.name = m.name;
    return preview;
  });
}

export class ContextManager {
  private readonly entries: ContextEntry[] = [];
  private readonly compactionLog: string[] = [];
  private seq = 0;

  constructor(
    private readonly config: HarnessConfig,
    private readonly slots: ProtectedSlots,
    private readonly summarizer: Summarizer = structuralSummarizer,
    private readonly logger?: LoggerPort,
    private readonly metrics?: MetricsPort,
  ) {}

  /** Append a message to the working set. */
  append(message: LLMMessage, options: { pinned?: boolean; id?: string } = {}): string {
    this.seq += 1;
    const id = options.id ?? `ctx-${this.seq}`;
    this.entries.push({
      id,
      message,
      tokens: estimateTokens(message.content) + estimateTokens(message.name ?? ''),
      pinned: options.pinned ?? false,
      compacted: false,
    });
    return id;
  }

  /** Replace the goal slot (used by clarify and by goal-drift re-anchoring). */
  setGoal(goal: string): void {
    this.slots.goal = goal;
  }

  addConstraint(constraint: string): void {
    if (!this.slots.constraints.includes(constraint)) this.slots.constraints.push(constraint);
  }

  setTodos(todos: string[]): void {
    this.slots.todos = [...todos];
  }

  addArtifact(path: string): void {
    if (!this.slots.artifacts.includes(path)) this.slots.artifacts.push(path);
  }

  get protectedSlots(): ProtectedSlots {
    return this.slots;
  }

  /** Tokens currently held, including the rendered slot block. */
  tokenUsage(): number {
    const body = this.entries.filter((e) => !e.compacted).reduce((sum, e) => sum + e.tokens, 0);
    return body + estimateTokens(renderSlots(this.slots));
  }

  budget(): TokenBudget {
    const used = withSafetyMargin(this.tokenUsage());
    return {
      window: this.config.contextWindow,
      softLimit: Math.floor(this.config.contextWindow * this.config.softLimitRatio),
      used,
    };
  }

  shouldCompact(): boolean {
    return this.tokenUsage() >= this.budget().softLimit;
  }

  /** Number of entries that are still live. */
  get liveCount(): number {
    return this.entries.filter((e) => !e.compacted).length;
  }

  /**
   * Compact older, non-pinned entries into a single summary message.
   *
   * Keeps the most recent `keepRecent` entries intact so the model retains
   * immediate task state.
   */
  async compact(reason: 'soft-limit' | 'hard-limit' = 'soft-limit', keepRecent = 6): Promise<CompactionResult> {
    const tokensBefore = this.tokenUsage();
    const live = this.entries.filter((e) => !e.compacted);
    const victims = live.filter((e) => !e.pinned).slice(0, Math.max(0, live.length - keepRecent));

    if (victims.length === 0) {
      return {
        performed: false,
        tokensBefore,
        tokensAfter: tokensBefore,
        dropped: 0,
        summaries: [],
        droppedPreviews: [],
        retention: 1,
      };
    }

    const summaryText = await this.summarizer(victims.map((v) => v.message));
    for (const victim of victims) victim.compacted = true;

    this.append(
      { role: 'system', content: summaryText },
      { pinned: true },
    );

    const tokensAfter = this.tokenUsage();
    this.compactionLog.push(
      `${reason}: folded ${victims.length} messages, ${tokensBefore} -> ${tokensAfter} tokens`,
    );
    this.metrics?.observe('ctx.tokens_before', tokensBefore);
    this.metrics?.observe('ctx.tokens_after', tokensAfter);
    this.metrics?.observe('ctx.compaction_ratio', tokensAfter / Math.max(1, tokensBefore));
    this.logger?.info('context compacted', { reason, dropped: victims.length, tokensBefore, tokensAfter });

    return {
      performed: true,
      tokensBefore,
      tokensAfter,
      dropped: victims.length,
      summaries: [summaryText],
      droppedPreviews: previewDropped(victims.map((v) => v.message)),
      retention: this.protectedSlotRetention(),
    };
  }

  /**
   * Fraction of protected-slot items present in the current context.
   * Used as the objective measure behind metric M5.
   */
  protectedSlotRetention(): number {
    const rendered = renderSlots(this.slots);
    const items = [
      this.slots.goal,
      ...this.slots.constraints,
      ...this.slots.todos,
      ...this.slots.artifacts,
    ].filter((item) => item.length > 0);
    if (items.length === 0) return 1;
    const present = items.filter((item) => rendered.includes(item)).length;
    return present / items.length;
  }

  /** Assemble the message list for a model call. */
  build(systemPrompt: string): BuiltContext {
    const messages: LLMMessage[] = [
      { role: 'system', content: `${systemPrompt}\n\n${renderSlots(this.slots)}` },
      ...this.entries.filter((e) => !e.compacted).map((e) => e.message),
    ];
    return { messages, budget: this.budget(), compactionLog: [...this.compactionLog] };
  }

  /** Snapshot of everything for persistence / debugging. */
  snapshot(): { live: number; compacted: number; log: string[]; slots: ProtectedSlots } {
    return {
      live: this.entries.filter((e) => !e.compacted).length,
      compacted: this.entries.filter((e) => e.compacted).length,
      log: [...this.compactionLog],
      slots: { ...this.slots },
    };
  }

  /**
   * Full context dump for the offline run record (Iteration 24): every entry —
   * live and compacted — plus the protected slots. Content is what was actually
   * appended; nothing is truncated here, because the record must show exactly
   * what the model saw.
   */
  dump(): { slots: ProtectedSlots; entries: Array<{ role: string; name?: string; content: string; pinned: boolean; compacted: boolean; tokens: number }> } {
    return {
      slots: { ...this.slots },
      entries: this.entries.map((entry) => ({
        role: entry.message.role,
        ...(typeof entry.message.name === 'string' ? { name: entry.message.name } : {}),
        content: entry.message.content,
        pinned: entry.pinned,
        compacted: entry.compacted,
        tokens: entry.tokens,
      })),
    };
  }
}

/** Render protected slots into the system message. Never truncated. */
export function renderSlots(slots: ProtectedSlots): string {
  const lines = ['<protected-context>'];
  lines.push(`goal: ${slots.goal || '(unset)'}`);
  lines.push(`constraints: ${slots.constraints.length ? slots.constraints.join(' | ') : '(none)'}`);
  lines.push(`open-todos: ${slots.todos.length ? slots.todos.join(' | ') : '(none)'}`);
  lines.push(`artifacts: ${slots.artifacts.length ? slots.artifacts.join(' | ') : '(none)'}`);
  lines.push('</protected-context>');
  return lines.join('\n');
}