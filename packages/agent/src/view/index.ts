/**
 * Browser-safe projection surface of `@camelia/agent`.
 *
 * Exposed as the `@camelia/agent/view` subpath so the UI can fold the engine's event
 * stream into render state without importing anything Node-only. This is the only
 * part of `agent` the webview is allowed to touch (whitepaper §2.2).
 * @module
 */

export * from './snapshot.js';
export * from './wire.js';