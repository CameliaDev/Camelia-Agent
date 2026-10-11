/**
 * Project profile. A small YAML subset, parsed here so the repo does not take a
 * YAML dependency. The file lives at `~/.camelia/profiles/<name>.yaml`.
 * @module
 */

export interface ProjectProfile {
  name: string;
  conventions: string[];
  pitfalls: string[];
  verification: string[];
  forbidden: string[];
}

const LIST_KEYS = ['conventions', 'pitfalls', 'verification', 'forbidden'] as const;

export function parseProjectProfile(source: string): ProjectProfile {
  const profile: ProjectProfile = {
    name: '',
    conventions: [],
    pitfalls: [],
    verification: [],
    forbidden: [],
  };
  let list: (typeof LIST_KEYS)[number] | undefined;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      if (!list) throw new Error('profile list item is outside a section');
      profile[list].push(unquote(item[1] ?? ''));
      continue;
    }
    const field = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!field) throw new Error(`profile line is not in the schema: ${line}`);
    const key = field[1] ?? '';
    const value = unquote(field[2] ?? '');
    if (key === 'name') {
      profile.name = value;
      list = undefined;
      continue;
    }
    if ((LIST_KEYS as readonly string[]).includes(key)) {
      list = key as (typeof LIST_KEYS)[number];
      if (value) profile[list].push(value);
      continue;
    }
    throw new Error(`profile key is not in the schema: ${key}`);
  }
  if (!profile.name) throw new Error('profile name is required');
  return profile;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Pull convention-like lines out of an iteration log. This is a compile step, not a prompt. */
export function profileFromIterationNotes(name: string, markdown: string): string {
  const pitfalls = [...markdown.matchAll(/^- .+$/gm)].slice(0, 8).map((match) => match[0].replace(/^- /, ''));
  const lines = [`name: ${name}`, 'conventions:', '  - Keep API keys in ~/.camelia', 'pitfalls:'];
  for (const pitfall of pitfalls) lines.push(`  - ${pitfall}`);
  if (pitfalls.length === 0) lines.push('  - No leftover notes were listed');
  lines.push('verification:', '  - Re-run the phase gate before trusting a number', 'forbidden:', '  - Do not send telemetry');
  return `${lines.join('\n')}\n`;
}
