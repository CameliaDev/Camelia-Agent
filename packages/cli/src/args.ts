/**
 * Zero-dependency argument parser.
 *
 * Hand-rolled on purpose (whitepaper §5.5): the CLI's argument surface is small and
 * fixed, and a 400-line dependency would be more risk than the parsing it replaces.
 * Unknown flags are reported rather than silently ignored, because a typo'd flag
 * that does nothing is how a user believes a safety switch is on when it is not.
 * @module
 */

export interface ParsedArgs {
  /** Positional arguments, in order. */
  positionals: string[];
  /** Flags that took a value (`--workspace x`). */
  options: Map<string, string>;
  /** Boolean flags present (`--yes`). */
  flags: Set<string>;
}

/** Flags that are boolean (never consume the next token as a value). */
const BOOLEAN_FLAGS = new Set([
  'mock',
  'yes',
  'auto-approve-plan',
  'json',
  'quiet',
  'verbose',
  'offline',
  'help',
  'version',
  'color',
  'no-color',
]);

export class ArgError extends Error {}

/** Expand `--key=value` into `['--key', 'value']`, then walk the tokens. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();

  const tokens: string[] = [];
  for (const raw of argv) {
    if (raw.startsWith('--') && raw.includes('=')) {
      const eq = raw.indexOf('=');
      tokens.push(raw.slice(0, eq), raw.slice(eq + 1));
    } else {
      tokens.push(raw);
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === '--') {
      positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.add(key);
        continue;
      }
      const value = tokens[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new ArgError(`flag --${key} requires a value`);
      }
      options.set(key, value);
      i += 1;
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      const short = token.slice(1);
      const key = SHORT_ALIASES[short];
      if (!key) throw new ArgError(`unknown flag -${short}`);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.add(key);
        continue;
      }
      const value = tokens[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new ArgError(`flag -${short} requires a value`);
      }
      options.set(key, value);
      i += 1;
      continue;
    }
    positionals.push(token);
  }

  return { positionals, options, flags };
}

const SHORT_ALIASES: Record<string, string> = {
  w: 'workspace',
  y: 'yes',
  p: 'provider',
  m: 'model',
  h: 'help',
  v: 'version',
  q: 'quiet',
};

/** Read a string option, falling back to a default. */
export function option(args: ParsedArgs, key: string, fallback?: string): string | undefined {
  return args.options.get(key) ?? fallback;
}