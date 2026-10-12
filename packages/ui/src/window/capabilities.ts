/**
 * Capability matrix for honest controls.
 *
 * This file answers one question: *can the thing behind this control actually do it?* It
 * exists so that a control which cannot work is disabled **with a stated reason** rather
 * than silently doing nothing. A button that looks live and isn't is worse than a button
 * that says why it is off.
 *
 * ## Why the table has two axes
 *
 * v2 assumed a single axis ("fixture supports it, live does not"), because the only
 * capabilities were intervene commands: the scripted transport implemented rollback and
 * mid-session provider switches that the live `EngineServer` still refuses. That was true
 * for those three and only those three.
 *
 * It is not true generally. `math_solve` is unavailable on **both** transports — the engine
 * has no `math.*` commands at all, and the fixture has no scripted math path either. So
 * each capability now declares both axes explicitly. The default for anything unlisted is
 * "not available", which is the honest failure direction.
 *
 * ## Future: engine-reported capabilities
 *
 * The plan book proposes a `ui.capabilities` event (or bootstrap field) so the engine
 * declares what it supports instead of the UI guessing. When that lands, this table
 * becomes the *fallback* for engines too old to report — unknown stays unsupported.
 * @module
 */

import { readEngineTrust } from './engine.js';

export type InterveneCapability =
  | 'rollback_step'
  | 'select_provider'
  | 'intervene_goal'
  // Math mode. None of these exist on either transport yet; they are listed so the UI has
  // one place to flip when the backend lands.
  | 'math_solve'
  | 'math_export_report'
  // Plan editing beyond what `edit_plan` already handles.
  | 'plan_edit';

interface CapabilitySpec {
  /**
   * Reason the control stays disabled on the live engine. Empty string means available.
   *
   * Ordinary sentence, user-facing: it is shown as a tooltip or inline note.
   */
  liveReason: string;
  /**
   * Reason it stays disabled on the scripted fixture. Empty means available.
   *
   * Fixture support is not a promise about the product — it only means the demo path
   * really implements the behaviour, so a reviewer clicking through sees a real result.
   */
  fixtureReason: string;
}

const CAPABILITIES: Record<InterveneCapability, CapabilitySpec> = {
  rollback_step: {
    liveReason: 'rollback is not available from the live engine yet',
    // The fixture really does replay a rollback, so the control is honest there.
    fixtureReason: '',
  },
  select_provider: {
    liveReason: 'provider switching mid-session is not available yet',
    fixtureReason: '',
  },
  intervene_goal: {
    liveReason: '',
    fixtureReason: '',
  },
  math_solve: {
    // No math commands on either transport. See the plan book §6, M-MATH-1.
    liveReason: 'the engine exposes no math commands yet — math.exec is only a tool',
    fixtureReason: 'the scripted transport has no math path either — load the labelled demo',
  },
  math_export_report: {
    liveReason: 'no report writer exists on the engine yet',
    fixtureReason: 'the demo has nothing to export',
  },
  plan_edit: {
    liveReason: '',
    // `edit_plan` is already handled by EngineServer, so the live path is the real one.
    fixtureReason: '',
  },
};

/** True when the webview is attached to a live camelia serve (not fixture). */
export function isLiveEngine(): boolean {
  return readEngineTrust().expectsLiveEngine;
}

/** Whether the current transport can honour this command. */
export function canIntervene(capability: InterveneCapability): boolean {
  const spec = CAPABILITIES[capability];
  // Unknown capability: fail closed. A capability we have not reasoned about must not be
  // presented as working.
  if (!spec) return false;
  return (isLiveEngine() ? spec.liveReason : spec.fixtureReason) === '';
}

/** Reason a control must stay disabled. Empty when available. */
export function interveneUnavailableReason(capability: InterveneCapability): string {
  const spec = CAPABILITIES[capability];
  if (!spec) return 'this capability is not implemented';
  return isLiveEngine() ? spec.liveReason : spec.fixtureReason;
}

/** The whole matrix, for tests and for the plan book's contract table. */
export function capabilityMatrix(): Record<InterveneCapability, { live: boolean; fixture: boolean }> {
  const out = {} as Record<InterveneCapability, { live: boolean; fixture: boolean }>;
  for (const [id, spec] of Object.entries(CAPABILITIES) as [InterveneCapability, CapabilitySpec][]) {
    out[id] = { live: spec.liveReason === '', fixture: spec.fixtureReason === '' };
  }
  return out;
}
