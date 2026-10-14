/**
 * Hard-gate memory write guard (ROADMAP stage 21) — only verified outcomes enter memory.
 *
 * Stub until Phase 4 wires verifier hard gates; keeps the contract explicit.
 * @module
 */

export interface MemoryWriteGateInput {
  /** True when the hard verifier gate passed for this observation. */
  hardGatePassed: boolean;
  /** Soft/async gates may pass without writing long-term memory. */
  softGateOnly?: boolean;
}

export interface MemoryWriteGateResult {
  readonly allow: boolean;
  readonly reason: string;
}

/** Returns whether a SkillRecord / curated memory write is permitted. */
export function mayWriteMemoryFromVerifier(input: MemoryWriteGateInput): MemoryWriteGateResult {
  if (input.softGateOnly) {
    return { allow: false, reason: 'soft gate only — memory write blocked' };
  }
  if (!input.hardGatePassed) {
    return { allow: false, reason: 'hard gate failed — memory write blocked' };
  }
  return { allow: true, reason: 'hard gate passed' };
}
