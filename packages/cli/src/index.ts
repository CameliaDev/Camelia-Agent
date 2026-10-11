/**
 * @camelia/cli — programmatic surface for the CLI.
 *
 * Exposed so the acceptance suites can drive the same commands the binary runs,
 * without spawning a process or scraping stdout.
 * @module
 */

export * from './args.js';
export * from './theme.js';
export * from './render.js';
export * from './version.js';
export * from './commands/run.js';
export * from './commands/doctor.js';
export * from './commands/replay.js';
export * from './commands/serve.js';
export * from './server/ApprovalBroker.js';
export * from './server/EngineServer.js';