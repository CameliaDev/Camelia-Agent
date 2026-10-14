/**
 * Global daily exploration budget (ARCH-Camelia-v8 §2.2).
 *
 * One cap, about 50, shared across error classes by demand. Demand is the
 * sum of that class's UNKNOWN rate and its unequal-residual density. A class
 * with neither signal gets nothing. The cap resets on the next UTC day.
 * There is no per-class fixed N and no global 100-sample cutoff.
 * @module
 */

import { DAILY_EXPLORATION_BUDGET, type AdviseErrorClass } from '@camelia/core';

export interface DemandCell {
  readonly seen: number;
  readonly unknown: number;
  readonly unequal: number;
  readonly consumed: number;
}

export interface BudgetState {
  readonly day: string;
  readonly consumed: number;
  readonly cap: number;
  readonly demand: Readonly<Record<string, DemandCell>>;
}

export function emptyBudget(now: number, cap = DAILY_EXPLORATION_BUDGET): BudgetState {
  return { day: dayKey(now), consumed: 0, cap, demand: {} };
}

export function noteDemand(
  state: BudgetState,
  errorClass: AdviseErrorClass,
  flags: { unknown: boolean; unequal: boolean },
  now: number,
): BudgetState {
  const rolled = roll(state, now);
  const cell = rolled.demand[errorClass] ?? { seen: 0, unknown: 0, unequal: 0, consumed: 0 };
  return {
    ...rolled,
    demand: {
      ...rolled.demand,
      [errorClass]: {
        seen: cell.seen + 1,
        unknown: cell.unknown + (flags.unknown ? 1 : 0),
        unequal: cell.unequal + (flags.unequal ? 1 : 0),
        consumed: cell.consumed,
      },
    },
  };
}

export function canExplore(state: BudgetState, errorClass: AdviseErrorClass, now: number): boolean {
  const rolled = roll(state, now);
  if (rolled.consumed >= rolled.cap) return false;
  const weight = weightOf(rolled.demand[errorClass]);
  if (weight <= 0) return false;
  const allowance = allowanceOf(rolled, errorClass);
  const consumed = rolled.demand[errorClass]?.consumed ?? 0;
  return allowance >= 1 && consumed < allowance;
}

export function consumeExplore(state: BudgetState, errorClass: AdviseErrorClass, now: number): BudgetState {
  const rolled = roll(state, now);
  const cell = rolled.demand[errorClass] ?? { seen: 0, unknown: 0, unequal: 0, consumed: 0 };
  return {
    ...rolled,
    consumed: rolled.consumed + 1,
    demand: { ...rolled.demand, [errorClass]: { ...cell, consumed: cell.consumed + 1 } },
  };
}

export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function roll(state: BudgetState, now: number): BudgetState {
  const day = dayKey(now);
  if (day === state.day) return state;
  return { day, consumed: 0, cap: state.cap, demand: {} };
}

function weightOf(cell: DemandCell | undefined): number {
  if (!cell || cell.seen <= 0) return 0;
  return cell.unknown / cell.seen + cell.unequal / cell.seen;
}

function allowanceOf(state: BudgetState, errorClass: AdviseErrorClass): number {
  let total = 0;
  for (const cell of Object.values(state.demand)) total += weightOf(cell);
  if (total <= 0) return 0;
  const weight = weightOf(state.demand[errorClass]);
  return Math.floor((state.cap * weight) / total);
}
