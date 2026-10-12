/**
 * Seeding the store for the `math-demo` screenshot scene.
 *
 * The scene deliberately emits **no domain events**. Math demonstration data is window
 * chrome, not engine state, so it is written to the store's `mathDemo` field — the same
 * field the user's own 加载演示课题 button writes to — and never folded into `snapshot`.
 *
 * That separation is the whole point: a screenshot of this scene shows the Offline badge
 * *and* the 演示 badge at once, which is the truthful description of what it is. If the
 * demo travelled through the event stream, the projection would look like a real run and
 * the badges would be the only thing standing between a reviewer and a false impression.
 * @module
 */

import { DEFAULT_MODE } from '../../mode/types.js';
import { type AppModeId } from '../../mode/types.js';
import { MATH_DEMO_FIRST } from './mathDemoFixture.js';
import type { UiStore } from '../../state/store.js';

/**
 * Apply scene-specific chrome after the store exists.
 *
 * Returns the mode the window should open in, or `undefined` when the scene says nothing
 * about modes (the caller then keeps the user's preference).
 */
export function applySceneBoot(store: UiStore, scene: string | null): AppModeId | undefined {
  if (scene !== 'math-demo') return undefined;
  store.getState().setMathDemo(MATH_DEMO_FIRST);
  store.getState().setMode('math');
  return 'math';
}

export { DEFAULT_MODE };
