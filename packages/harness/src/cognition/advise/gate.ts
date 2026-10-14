/**
 * Human gates L0–L3 and the trust window (ARCH-Camelia-v7 §2.5, v8 §2.4).
 *
 * L0 is the most autonomous, L3 the strictest. The shipped default is L2.
 * Exploration is allowed only at L1. A manual raise enters manual mode and
 * pauses automatic lowering. A manual lower returns to automatic mode and
 * clears the success streak, so stored successes cannot immediately lower
 * the gate again. Three quiet successes also leave manual mode, without
 * lowering in that same step.
 * @module
 */

import {
  HUMAN_GATE_LEVELS,
  STRUCTURED_FAIL_M,
  TRUST_SUCCESS_M,
  type AdviseErrorClass,
  type HumanGateLevel,
} from '@camelia/core';

export interface GateState {
  readonly level: HumanGateLevel;
  readonly mode: 'auto' | 'manual';
  readonly successStreak: number;
  readonly quietSuccesses: number;
  readonly streaks: Readonly<Record<string, number>>;
  readonly raisesAuto: number;
  readonly raisesManual: number;
}

export function createGate(level: HumanGateLevel = 'L2'): GateState {
  return { level, mode: 'auto', successStreak: 0, quietSuccesses: 0, streaks: {}, raisesAuto: 0, raisesManual: 0 };
}

export function streakKey(verifierId: string, errorClass: AdviseErrorClass): string {
  return `${verifierId}\u0000${errorClass}`;
}

export function requiresHuman(level: HumanGateLevel, forced: boolean): boolean {
  if (forced) return true;
  return level === 'L2' || level === 'L3';
}

/** ε is isolated to L1 and never runs while a human is required. */
export function explorationAllowed(level: HumanGateLevel, forced: boolean): boolean {
  return level === 'L1' && !forced;
}

export function noteStructuredMismatch(
  state: GateState,
  verifierId: string,
  errorClass: AdviseErrorClass,
  unequal: boolean,
): { state: GateState; raised: boolean } {
  const key = streakKey(verifierId, errorClass);
  if (!unequal) {
    if ((state.streaks[key] ?? 0) === 0) return { state, raised: false };
    return { state: { ...state, streaks: { ...state.streaks, [key]: 0 } }, raised: false };
  }
  const nextCount = (state.streaks[key] ?? 0) + 1;
  if (nextCount < STRUCTURED_FAIL_M || state.level === 'L3') {
    return { state: { ...state, streaks: { ...state.streaks, [key]: nextCount } }, raised: false };
  }
  return {
    raised: true,
    state: {
      ...state,
      level: step(state.level, 1),
      streaks: { ...state.streaks, [key]: 0 },
      raisesAuto: state.raisesAuto + 1,
    },
  };
}

export function noteSuccess(state: GateState): { state: GateState; lowered: boolean; leftManual: boolean } {
  const cleared: GateState = {
    ...state,
    successStreak: state.successStreak + 1,
    quietSuccesses: state.quietSuccesses + 1,
    streaks: {},
  };
  if (cleared.mode === 'manual') {
    if (cleared.quietSuccesses < TRUST_SUCCESS_M) return { state: cleared, lowered: false, leftManual: false };
    return {
      lowered: false,
      leftManual: true,
      state: { ...cleared, mode: 'auto', successStreak: 0, quietSuccesses: 0 },
    };
  }
  if (cleared.successStreak < TRUST_SUCCESS_M || cleared.level === 'L0') {
    return { state: cleared, lowered: false, leftManual: false };
  }
  return {
    lowered: true,
    leftManual: false,
    state: { ...cleared, level: step(cleared.level, -1), successStreak: 0, quietSuccesses: 0 },
  };
}

export function manualRaise(state: GateState): GateState {
  return {
    ...state,
    level: state.level === 'L3' ? 'L3' : step(state.level, 1),
    mode: 'manual',
    quietSuccesses: 0,
    raisesManual: state.raisesManual + 1,
  };
}

/** Manual lower restores automatic mode and zeroes the success window. */
export function manualLower(state: GateState): GateState {
  return {
    ...state,
    level: state.level === 'L0' ? 'L0' : step(state.level, -1),
    mode: 'auto',
    successStreak: 0,
    quietSuccesses: 0,
  };
}

function step(level: HumanGateLevel, delta: number): HumanGateLevel {
  const index = HUMAN_GATE_LEVELS.indexOf(level);
  const next = Math.min(HUMAN_GATE_LEVELS.length - 1, Math.max(0, index + delta));
  return HUMAN_GATE_LEVELS[next] ?? level;
}
