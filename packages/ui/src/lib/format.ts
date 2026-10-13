/**
 * Presentation helpers. Formatting only — no business logic lives here.
 * @module
 */

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function ms(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

/** Byte size for an artifact row. Missing size stays blank at the call site. */
export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function count(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function shortId(id: string, length = 8): string {
  return id.length > length ? id.slice(0, length) : id;
}

export function clock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Compact, single-line JSON preview for tool inputs. */
export function preview(value: unknown, max = 120): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Pretty JSON for the expanded tool view, bounded so one huge output can't freeze the DOM. */
export function prettyJson(value: unknown, max = 4000): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined) return '';
  return text.length > max ? `${text.slice(0, max)}\n… truncated` : text;
}

export function languageForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    rs: 'rust',
    py: 'python',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    toml: 'ini',
  };
  return map[ext] ?? 'plaintext';
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Render a `fs.write` payload as added lines and an `fs.edit` payload as a diff. */
export function diffLines(oldText: string, newText: string): { kind: 'add' | 'del' | 'ctx'; text: string }[] {
  const before = oldText.length ? oldText.replace(/\n$/, '').split('\n') : [];
  const after = newText.replace(/\n$/, '').split('\n');
  const rows: { kind: 'add' | 'del' | 'ctx'; text: string }[] = [];
  if (!before.length) {
    for (const line of after) rows.push({ kind: 'add', text: line });
    return rows;
  }
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i += 1) {
    const b = before[i];
    const a = after[i];
    if (b === a) rows.push({ kind: 'ctx', text: a ?? '' });
    else {
      if (b !== undefined) rows.push({ kind: 'del', text: b });
      if (a !== undefined) rows.push({ kind: 'add', text: a });
    }
  }
  return rows;
}