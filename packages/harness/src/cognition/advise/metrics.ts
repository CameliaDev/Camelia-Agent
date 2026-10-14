/**
 * Two-tier advise metrics (ARCH-Camelia-v8 §2.1).
 *
 * Health is the default row: human-gate pass rate, residual distribution,
 * and gate raises split into automatic and manual. Diagnostics stay a second
 * row: router hits, translate rejects, and skill rows written today.
 * @module
 */

import type { AdviseErrorClass, AdviseMetricsSnapshot } from '@camelia/core';

import type { GateState } from './gate.js';
import { dayKey } from './exploration.js';

export interface MetricsState {
  readonly gatePresentations: number;
  readonly gatePasses: number;
  readonly translateAttempts: number;
  readonly translateRejects: number;
  readonly routerHitsA: number;
  readonly routerHitsB: number;
  readonly residualUnequal: Readonly<Record<string, number>>;
  readonly skillsToday: number;
  readonly skillDay: string;
}

export function emptyMetrics(now: number): MetricsState {
  return {
    gatePresentations: 0,
    gatePasses: 0,
    translateAttempts: 0,
    translateRejects: 0,
    routerHitsA: 0,
    routerHitsB: 0,
    residualUnequal: {},
    skillsToday: 0,
    skillDay: dayKey(now),
  };
}

export function bumpResidual(state: MetricsState, errorClass: AdviseErrorClass): MetricsState {
  return {
    ...state,
    residualUnequal: { ...state.residualUnequal, [errorClass]: (state.residualUnequal[errorClass] ?? 0) + 1 },
  };
}

export function noteSkillWritten(state: MetricsState, now: number): MetricsState {
  const day = dayKey(now);
  const base = day === state.skillDay ? state.skillsToday : 0;
  return { ...state, skillDay: day, skillsToday: base + 1 };
}

export function snapshotMetrics(metrics: MetricsState, gate: GateState): AdviseMetricsSnapshot {
  return {
    health: {
      gatePassRate: metrics.gatePresentations === 0 ? null : metrics.gatePasses / metrics.gatePresentations,
      residualDistribution: metrics.residualUnequal,
      gateRaisesAuto: gate.raisesAuto,
      gateRaisesManual: gate.raisesManual,
    },
    diagnostic: {
      routerHitsA: metrics.routerHitsA,
      routerHitsB: metrics.routerHitsB,
      translateRejectRate: metrics.translateAttempts === 0 ? null : metrics.translateRejects / metrics.translateAttempts,
      skillRecordsToday: metrics.skillsToday,
    },
    trust: {
      level: gate.level,
      mode: gate.mode,
      successStreak: gate.successStreak,
    },
  };
}
