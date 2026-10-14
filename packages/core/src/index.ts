/**
 * @camelia/core — contracts and infrastructure for Camelia.
 *
 * This package knows nothing about `harness`. It defines the vocabulary
 * (types), the transport (event bus), the lifecycle (state machine), the
 * boundaries (ports) and the plumbing (persistence, observability).
 *
 * Dependency direction: `core <- harness <- agent <- ui`. Never the reverse.
 *
 * @packageDocumentation
 */

// ---- types -----------------------------------------------------------------
export * from './types/common.js';
export * from './types/domain.js';
export * from './types/cognition.js';
export * from './types/translate-v1.js';
export * from './types/advise.js';
export * from './types/events.js';
export * from './types/plugins.js';
export * from './types/presets.js';
export * from './types/mcp.js';

// ---- infrastructure --------------------------------------------------------
export * from './events/EventBus.js';
export * from './state/TaskStateMachine.js';

// ---- ports -----------------------------------------------------------------
export * from './ports/llm.js';
export * from './ports/cognition.js';
export * from './ports/fs.js';
export * from './ports/shell.js';
export * from './ports/search.js';
export * from './ports/clock.js';
export * from './ports/logger.js';

// ---- persistence -----------------------------------------------------------
export * from './persistence/schema.js';
export * from './persistence/SessionStore.js';
export * from './persistence/SqliteSessionStore.js';

// ---- observability ---------------------------------------------------------
export * from './observability/Tracer.js';
export * from './observability/Metrics.js';
export * from './observability/Logger.js';

// ---- utils -----------------------------------------------------------------
export * from './utils/id.js';
export * from './utils/tokens.js';
export * from './utils/paths.js';
export * from './utils/local-time.js';
export * from './utils/model-capabilities.js';
export * from './memory/curated.js';