/**
 * First-launch login gate.
 *
 * The page shows when this install has never dismissed it and nobody is signed
 * in. Skipping writes the flag, and so does signing out — a guest who already
 * chose to continue should not see the page again.
 * @module
 */

export const LOGIN_GATE_KEY = 'camelia.loginGate';

export function loginGatePassed(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(LOGIN_GATE_KEY) === 'skipped';
  } catch {
    return false;
  }
}

export function markLoginGatePassed(storage: Storage = localStorage): void {
  try {
    storage.setItem(LOGIN_GATE_KEY, 'skipped');
  } catch {
    // Private mode can refuse the write. The in-memory flag still hides the page.
  }
}
