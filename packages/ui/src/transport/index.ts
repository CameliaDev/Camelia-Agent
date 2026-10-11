/**
 * Transport factory.
 *
 * Two implementations share one contract: the fixture (offline demos, screenshots,
 * UI tests) and SSE (a live `camelia serve` engine). Selection is by *configuration*,
 * never by guesswork: an engine URL means a live engine; otherwise the fixture replays
 * the requested scene. Nothing above this line changes between the two.
 * @module
 */

import { readBootConfig } from './boot.js';
import { FixtureTransport, type FixtureOptions } from './fixture.js';
import { isSceneId, type SceneId } from './scenario.js';
import { SseTransport } from './sse.js';
import type { Transport } from './types.js';

export function createTransport(search: string): Transport {
  const params = new URLSearchParams(search);
  const boot = readBootConfig();

  // A live engine wins over everything: if the shell pointed us at one, the scene is
  // irrelevant — projecting a scripted task while a real engine is attached would lie.
  const engineUrl = boot.engineUrl ?? params.get('engineUrl');
  if (engineUrl) {
    return new SseTransport({
      baseUrl: engineUrl,
      ...(boot.sessionId ? { sessionId: boot.sessionId } : {}),
    });
  }

  // Precedence: the native shell's boot config beats the URL, and the URL beats the
  // default. Default to the empty state — a shipped app must not project a task that was
  // never received; `?scene=<id>` (browser) or `--scene=<id>` (shell) asks for more.
  const sceneParam = boot.scene ?? params.get('scene') ?? null;
  const scene: SceneId = isSceneId(sceneParam) ? sceneParam : 'empty';
  const replay: FixtureOptions['replay'] = params.get('replay') === 'timed' ? 'timed' : 'instant';
  return new FixtureTransport({ scene, replay });
}

export * from './types.js';
export * from './boot.js';
export * from './scenario.js';
export { FixtureTransport };
export type { FixtureOptions };
export { SseTransport };
export type { SseTransportOptions, EventSourceLike } from './sse.js';