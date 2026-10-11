/**
 * Hallucination guard — "evidence or it didn't happen".
 *
 * Whitepaper §4.2: any completion claim must be bound to a real tool call. A
 * claim without evidence is downgraded to `unknown` rather than trusted.
 * @module
 */

import type { Evidence } from '@camelia/core';

/** Phrases that assert the work is finished. */
const COMPLETION_PATTERNS: RegExp[] = [
  /\b(done|complete|completed|finished|implemented|created|added|fixed|passes|passing|all tests? pass)\b/i,
  /(已完成|完成了|已实现|已添加|已修复|已创建|测试通过|构建通过)/,
];

/** Phrases that assert a file or symbol exists. */
const EXISTENCE_PATTERNS: RegExp[] = [
  /\b(file|function|class|module)\s+["'`]?[\w./-]+["'`]?\s+(exists|was created|has been created)\b/i,
];

export interface ClaimVerdict {
  blocked: boolean;
  /** The offending sentence, trimmed. */
  claim: string;
  reason: string;
}

export class HallucinationGuard {
  /**
   * Check a model's claim against the evidence collected for the step.
   *
   * `evidence` must contain at least one `tool-call` or `command-output` entry
   * for a completion claim to survive.
   */
  checkClaim(text: string, evidence: Evidence[]): ClaimVerdict {
    const sentence = this.findClaimSentence(text);
    if (!sentence) return { blocked: false, claim: '', reason: '' };

    const hasToolEvidence = evidence.some(
      (e) => e.kind === 'tool-call' || e.kind === 'command-output' || e.kind === 'file-hash',
    );
    if (hasToolEvidence) return { blocked: false, claim: sentence, reason: '' };

    return {
      blocked: true,
      claim: sentence,
      reason:
        'Completion was claimed with no tool-call evidence. Run the work and verify with a command before claiming it is done.',
    };
  }

  /** True when the text asserts completion at all. */
  isCompletionClaim(text: string): boolean {
    return this.findClaimSentence(text) !== undefined;
  }

  private findClaimSentence(text: string): string | undefined {
    const sentences = text.split(/(?<=[.!?。！？])\s+/);
    for (const sentence of sentences) {
      if (COMPLETION_PATTERNS.some((p) => p.test(sentence)) || EXISTENCE_PATTERNS.some((p) => p.test(sentence))) {
        return sentence.trim();
      }
    }
    return undefined;
  }
}