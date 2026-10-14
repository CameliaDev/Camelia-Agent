/**
 * Ephemeral shell state that is not part of the engine snapshot.
 *
 * Math setup and the term timeline are window chrome. Putting them on the
 * task snapshot would make a mode switch look like a domain event.
 * @module
 */

import { useSyncExternalStore } from 'react';

export type MathContest = 'cumcm' | 'mcm' | 'other';

export interface MathSessionProfile {
  contest: MathContest;
  useTemplates: boolean;
}

export type TermPhase = 'plan' | 'execute' | 'verify' | 'done';

export interface TermRun {
  sessionId: string;
  intent: string;
  phase: TermPhase;
}

interface ShellExtras {
  mathSetupOpen: boolean;
  mathProfiles: Record<string, MathSessionProfile>;
  termRun?: TermRun;
}

let state: ShellExtras = { mathSetupOpen: false, mathProfiles: {} };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState(): ShellExtras {
  return state;
}

export function resetShellExtras(): void {
  state = { mathSetupOpen: false, mathProfiles: {} };
  emit();
}

export function setMathSetupOpen(open: boolean): void {
  if (state.mathSetupOpen === open) return;
  state = { ...state, mathSetupOpen: open };
  emit();
}

export function setMathProfile(sessionId: string, profile: MathSessionProfile): void {
  state = { ...state, mathProfiles: { ...state.mathProfiles, [sessionId]: profile }, mathSetupOpen: false };
  emit();
}

export function setTermRun(run: TermRun | undefined): void {
  state = { ...state, termRun: run };
  emit();
}

const NEXT_PHASE: Record<TermPhase, TermPhase> = {
  plan: 'execute',
  execute: 'verify',
  verify: 'done',
  done: 'done',
};

export function advanceTermRun(): void {
  const run = state.termRun;
  if (!run || run.phase === 'done') return;
  state = { ...state, termRun: { ...run, phase: NEXT_PHASE[run.phase] } };
  emit();
}

export function useMathSetupOpen(): boolean {
  return useSyncExternalStore(subscribe, () => getState().mathSetupOpen);
}

export function useMathProfile(sessionId: string | undefined): MathSessionProfile | undefined {
  return useSyncExternalStore(subscribe, () => (sessionId ? getState().mathProfiles[sessionId] : undefined));
}

export function useTermRun(): TermRun | undefined {
  return useSyncExternalStore(subscribe, () => getState().termRun);
}
