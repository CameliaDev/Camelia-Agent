/**
 * Camelia home directory layout.
 *
 * Everything Camelia persists lives under `~/.camelia/` and nothing else — API
 * keys, the database, certificates and logs. Zero telemetry, no writes elsewhere
 * (whitepaper appendix A, rule 12).
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Absolute path of the Camelia home directory. */
export function cameliaHome(): string {
  return process.env.CAMELIA_HOME ?? path.join(os.homedir(), '.camelia');
}

export const paths = {
  home: cameliaHome,
  config: () => path.join(cameliaHome(), 'config.json'),
  keys: () => path.join(cameliaHome(), 'keys.json'),
  database: () => path.join(cameliaHome(), 'camelia.db'),
  logs: () => path.join(cameliaHome(), 'logs'),
  certs: () => path.join(cameliaHome(), 'certs'),
  backups: () => path.join(cameliaHome(), 'backups'),
  /** Root scanned for plugin directories, each with a `camelia.plugin.json`. */
  plugins: () => path.join(cameliaHome(), 'plugins'),
  /** Root scanned for standalone `*.json` agent presets. */
  presets: () => path.join(cameliaHome(), 'presets'),
  /** MCP server definitions (whitepaper §8.5). Data only, never executed. */
  mcp: () => path.join(cameliaHome(), 'mcp.json'),
  /** Extra CA bundle, used when the machine sits behind a TLS-inspecting proxy. */
  caBundle: () => path.join(cameliaHome(), 'certs', 'windows-roots.pem'),
};

/**
 * Create the home directory tree if it is missing.
 *
 * Called by the composition root before anything opens a file: SQLite will not
 * create a missing directory, and a first run that dies with "unable to open
 * database" is the worst possible first impression (whitepaper §9.1 — a task the
 * user asked for must not fail on our plumbing).
 */
export function ensureCameliaHome(): string {
  const home = cameliaHome();
  for (const dir of [home, paths.logs(), paths.certs(), paths.backups(), paths.plugins(), paths.presets()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return home;
}

/** Environment variables that may carry provider credentials. */
export const keyEnvVars = {
  opencodeZen: ['CAMELIA_OPENCODE_ZEN_API_KEY', 'OPENCODE_ZEN_API_KEY'],
  openrouter: ['CAMELIA_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
  ollama: ['CAMELIA_OLLAMA_BASE_URL', 'OLLAMA_HOST'],
} as const;