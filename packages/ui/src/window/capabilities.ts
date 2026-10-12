/**
 * Live-engine capability matrix for honest intervene UI.
 * Fixture transport implements rollback / mid-session provider switch;
 * the live EngineServer still returns hard errors for those commands.
 * @module
 */

import { readEngineTrust } from './engine.js';

export type InterveneCapability = 'rollback_step' | 'select_provider' | 'intervene_goal';

const LIVE_UNAVAILABLE: Record<InterveneCapability, string> = {
  rollback_step: 'rollback is not available from the live engine yet',
  select_provider: 'provider switching mid-session is not available yet',
  intervene_goal: '',
};

/** True when the webview is attached to a live camelia serve (not fixture). */
export function isLiveEngine(): boolean {
  return readEngineTrust().expectsLiveEngine;
}

/** Whether the current transport can honour this intervene command. */
export function canIntervene(capability: InterveneCapability): boolean {
  if (!isLiveEngine()) return true;
  return !LIVE_UNAVAILABLE[capability];
}

/** Engine-facing reason when a control must stay disabled. Empty when available. */
export function interveneUnavailableReason(capability: InterveneCapability): string {
  if (canIntervene(capability)) return '';
  return LIVE_UNAVAILABLE[capability];
}
