/**
 * Lightweight code and diff rendering.
 *
 * Deliberately not Monaco: a tool card shows a few dozen lines, and Monaco is loaded
 * on demand only for the full editor pane (whitepaper §6.6). Rendering here is plain
 * React elements — never `dangerouslySetInnerHTML` — so tool output cannot inject markup.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { basename, diffLines, languageForPath } from '../lib/format.js';
import { Icon } from './primitives.js';

const KEYWORD_SET = new Set(
  (
    'import from export default const let var function return if else for while await async new class extends ' +
    'interface type enum implements public private readonly as in of throw try catch finally switch case break ' +
    'continue typeof instanceof void null undefined true false this super yield def elif lambda pass None True ' +
    'False with not and or'
  ).split(' '),
);

interface Token {
  text: string;
  cls: string;
}

/**
 * A deliberately small tokenizer: comments, strings, numbers, keywords, punctuation.
 * It is not a parser and does not pretend to be one — it exists so tool output reads
 * like code instead of a wall of monochrome text.
 */
function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let rest = line;
  while (rest.length) {
    const comment = /^(\/\/.*|#.*|--.*)/.exec(rest);
    if (comment) {
      tokens.push({ text: comment[1]!, cls: 'text-ink-3 italic' });
      break;
    }
    const string = /^(['"`])(?:\\.|(?!\1).)*\1/.exec(rest);
    if (string) {
      tokens.push({ text: string[0], cls: 'text-ok' });
      rest = rest.slice(string[0].length);
      continue;
    }
    const keyword = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (keyword) {
      tokens.push({ text: keyword[0], cls: KEYWORD_SET.has(keyword[0]) ? 'text-accent-2' : 'text-ink' });
      rest = rest.slice(keyword[0].length);
      continue;
    }
    const number = /^\d[\w.]*/.exec(rest);
    if (number) {
      tokens.push({ text: number[0], cls: 'text-info' });
      rest = rest.slice(number[0].length);
      continue;
    }
    const other = /^[^\w'"`/#-]+|^[-/#]/.exec(rest);
    const text = other ? other[0] : rest[0]!;
    tokens.push({ text, cls: 'text-ink-2' });
    rest = rest.slice(text.length);
  }
  return tokens;
}

function HighlightedLine({ text }: { text: string }): ReactNode {
  return (
    <>
      {tokenize(text).map((token, i) => (
        <span key={i} className={token.cls}>
          {token.text}
        </span>
      ))}
    </>
  );
}

export function CodeBlock({
  code,
  path,
  language,
  maxLines = 400,
  startLine = 1,
}: {
  code: string;
  path?: string;
  language?: string;
  maxLines?: number;
  startLine?: number;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const all = code.replace(/\n$/, '').split('\n');
  const shown = all.slice(0, maxLines);
  const lang = language ?? (path ? languageForPath(path) : 'plaintext');

  const copy = (): void => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => undefined,
    );
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-base/70">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5">
        <span className="truncate font-mono text-[11px] text-ink-3">
          {path ? basename(path) : lang}
          {path ? <span className="ml-2 text-ink-3/70">{path}</span> : null}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded border border-line px-1.5 py-[1px] text-[10px] text-ink-3 hover:border-accent/40 hover:text-accent"
        >
          <Icon name={copied ? 'check' : 'copy'} size={11} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-2 py-2 font-mono text-[11.5px] leading-[1.65]">
        <code>
          {shown.map((line, i) => (
            <div key={i} className="flex">
              <span className="mr-3 w-8 shrink-0 select-none text-right text-ink-3/60">{startLine + i}</span>
              <span className="whitespace-pre">
                <HighlightedLine text={line} />
              </span>
            </div>
          ))}
          {all.length > maxLines ? (
            <div className="mt-1 text-ink-3">… {all.length - maxLines} more lines</div>
          ) : null}
        </code>
      </pre>
    </div>
  );
}

export function DiffBlock({
  oldText,
  newText,
  path,
}: {
  oldText: string;
  newText: string;
  path?: string;
}): ReactNode {
  const rows = diffLines(oldText, newText);
  const added = rows.filter((r) => r.kind === 'add').length;
  const removed = rows.filter((r) => r.kind === 'del').length;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-base/70">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5">
        <span className="truncate font-mono text-[11px] text-ink-3">
          {path ? basename(path) : 'diff'}
          {path ? <span className="ml-2 text-ink-3/70">{path}</span> : null}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px]">
          <span className="text-ok">+{added}</span>
          <span className="text-bad">-{removed}</span>
        </span>
      </div>
      <pre className="overflow-x-auto px-2 py-2 font-mono text-[11.5px] leading-[1.65]">
        <code>
          {rows.map((row, i) => (
            <div
              key={i}
              className={
                row.kind === 'add'
                  ? 'flex bg-[var(--color-add)]'
                  : row.kind === 'del'
                    ? 'flex bg-[var(--color-del)]'
                    : 'flex'
              }
            >
              <span
                className={`mr-2 w-3 shrink-0 select-none text-center ${
                  row.kind === 'add' ? 'text-ok' : row.kind === 'del' ? 'text-bad' : 'text-ink-3/40'
                }`}
              >
                {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
              </span>
              <span className="whitespace-pre text-ink-2">
                <HighlightedLine text={row.text} />
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}