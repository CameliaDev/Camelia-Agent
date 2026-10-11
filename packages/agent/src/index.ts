/**
 * @camelia/agent — orchestration, providers, routing and the composition root.
 *
 * Depends on `@camelia/harness` and `@camelia/core`. This is the layer that
 * chooses *concrete* implementations (Node adapters, SQLite, HTTP providers) and
 * hands them to the harness as ports (whitepaper §2.2, §5.3).
 *
 * Dependency direction: `core <- harness <- agent <- ui/cli`. Never the reverse.
 *
 * @packageDocumentation
 */

// ---- configuration ---------------------------------------------------------
export * from './config/load.js';
export * from './config/paths.js';

// ---- adapters --------------------------------------------------------------
export * from './adapters/NodeFs.js';
export * from './adapters/NodeShell.js';
export * from './adapters/NodeSearch.js';
export * from './adapters/logger.js';

// ---- providers -------------------------------------------------------------
export * from './providers/OpenAICompatibleProvider.js';
export * from './providers/MockProvider.js';
export * from './providers/ScriptedAgentProvider.js';
export * from './ProviderRegistry.js';
export * from './FallbackLLMPort.js';
export * from './ModelRouter.js';

// ---- extension points (whitepaper §8) --------------------------------------
export * from './presets/builtins.js';
export * from './presets/PresetRegistry.js';
export * from './plugins/PluginLoader.js';
export * from './plugins/sandbox.js';

// ---- runtime (composition root) --------------------------------------------
export * from './runtime/CameliaRuntime.js';
export * from './runtime/ApprovalResponders.js';