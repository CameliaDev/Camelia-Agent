/**
 * Ephemeral shell state that is not part of the engine snapshot.
 *
 * Math setup is window chrome. Putting it on the task snapshot would make a
 * mode switch look like a domain event. Term stages come from the engine task.
 * @module
 */

import { useSyncExternalStore } from 'react';

export type MathContest = 'cumcm' | 'mcm' | 'other';

export interface MathSessionProfile {
  contest: MathContest;
  useTemplates: boolean;
}

interface ShellExtras {
  mathSetupOpen: boolean;
  mathProfiles: Record<string, MathSessionProfile>;
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

export function useMathSetupOpen(): boolean {
  return useSyncExternalStore(subscribe, () => getState().mathSetupOpen);
}

export function useMathProfile(sessionId: string | undefined): MathSessionProfile | undefined {
  return useSyncExternalStore(subscribe, () => (sessionId ? getState().mathProfiles[sessionId] : undefined));
}
