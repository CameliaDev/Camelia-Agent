/**
 * Tool-call card.
 *
 * This is where the whitepaper's "the user can see every tool call — input, output,
 * duration, and whether it needed approval" requirement becomes pixels. Collapsed it
 * shows a one-line summary; expanded it shows the real arguments, a diff for edits, and
 * the raw output.
 * @module
 */

import { useState, type ReactNode } from 'react';

import type { ToolCallView } from '@camelia/agent/view';

import { ms, prettyJson, preview } from '../lib/format.js';
import { APPROVAL_META, RISK_META, TONE_TEXT, TOOL_STATUS_META } from '../lib/status.js';
import { CodeBlock, DiffBlock } from './CodeBlock.js';
import { Chip, Icon, StatusDot } from './primitives.js';

const TOOL_ICON: Record<string, string> = {
  'fs.read': 'file',
  'fs.write': 'file',
  'fs.edit': 'file',
  'shell.run': 'terminal',
  'search.grep': 'search',
  'search.glob': 'search',
};

interface FsEditInput {
  path?: string;
  oldText?: string;
  newText?: string;
  content?: string;
}

interface ShellInput {
  cmd?: string;
  cwd?: string;
}

interface SearchInput {
  pattern?: string;
  glob?: string;
}

/** A one-line, human summary of the call — the collapsed state. */
function summarise(call: ToolCallView): string {
  const input = call.input as FsEditInput & ShellInput & SearchInput;
  switch (call.name) {
    case 'fs.read':
    case 'fs.write':
    case 'fs.edit':
      return input.path ?? '';
    case 'shell.run':
      return [input.cmd, input.cwd ? `in ${input.cwd}` : ''].filter(Boolean).join(' ');
    case 'search.grep':
    case 'search.glob':
      return [input.pattern, input.glob ? `(${input.glob})` : ''].filter(Boolean).join(' ');
    default:
      return preview(call.input, 90);
  }
}

export function ToolCard({ call, defaultOpen = false }: { call: ToolCallView; defaultOpen?: boolean }): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const status = TOOL_STATUS_META[call.status];
  const risk = RISK_META[call.risk];
  const approval = APPROVAL_META[call.approval];
  const input = call.input as FsEditInput;
  const isEdit = call.name === 'fs.edit' && typeof input.oldText === 'string' && typeof input.newText === 'string';
  const isWrite = call.name === 'fs.write' && typeof input.content === 'string';

  return (
    <div
      className={`rounded-lg border bg-elevated/60 transition-colors ${
        call.status === 'error' ? 'border-bad/35' : call.status === 'awaiting-approval' ? 'border-warn/35' : 'border-line'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-hover/40"
        aria-expanded={open}
      >
        <Icon
          name="chevron"
          size={12}
          className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Icon name={TOOL_ICON[call.name] ?? 'dot'} size={14} className={`shrink-0 ${TONE_TEXT[status.tone]}`} />
        <span className="shrink-0 font-mono text-[11.5px] font-medium text-ink">{call.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3">{summarise(call)}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {call.risk !== 'read-only' ? <Chip tone={risk.tone}>{risk.label}</Chip> : null}
          {call.approval === 'required' ? <Chip tone={approval.tone}>{approval.label}</Chip> : null}
          <span className="font-mono text-[10.5px] text-ink-3">{ms(call.durationMs)}</span>
          <span className={`flex items-center gap-1 text-[11px] font-medium ${TONE_TEXT[status.tone]}`}>
            {call.status === 'running' ? (
              <StatusDot tone="accent" pulse />
            ) : (
              <Icon
                name={
                  call.status === 'ok'
                    ? 'check'
                    : call.status === 'error' || call.status === 'denied'
                      ? 'x'
                      : call.status === 'awaiting-approval'
                        ? 'clock'
                        : 'dot'
                }
                size={12}
              />
            )}
            {status.label}
          </span>
        </span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-line px-2.5 py-2.5">
          {isEdit ? (
            <DiffBlock oldText={input.oldText!} newText={input.newText!} path={input.path} />
          ) : isWrite ? (
            <CodeBlock code={input.content!} path={input.path} />
          ) : (
            <CodeBlock code={prettyJson(call.input, 1200)} language="json" />
          )}

          {call.error ? (
            <div className="rounded border border-bad/30 bg-bad/10 px-2 py-1.5 font-mono text-[11px] text-bad">
              {call.error}
            </div>
          ) : null}

          {call.output !== undefined ? (
            <details className="group">
              <summary className="cursor-pointer list-none text-[11px] text-ink-3 hover:text-ink-2">
                <span className="inline-flex items-center gap-1">
                  <Icon name="chevron" size={11} className="transition-transform group-open:rotate-90" />
                  output
                </span>
              </summary>
              <div className="mt-1.5">
                <CodeBlock code={prettyJson(call.output, 2000)} language="json" />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}