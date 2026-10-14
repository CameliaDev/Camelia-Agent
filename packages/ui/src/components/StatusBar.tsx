/**
 * Status bar — the strip along the bottom edge.
 *
 * ## Why it spans the whole window
 *
 * VS Code's status bar is not part of the editor area: it runs the full window width,
 * *under* the activity bar and both side panels, and the panels' bottom edges stop at it.
 * That is the whole reason it reads as "the window's own footer" rather than "another
 * panel". So this is absolutely positioned across `inset-x-0` and the rails grid gets a
 * `padding-bottom`, exactly the way `TopBar` uses `padding-top`.
 *
 * The alternative — making it a fifth grid column, or a second grid row — is what an
 * earlier attempt at a left-hand footer did, and it cost the composer ~68px of height and
 * cut the right rail's divider. A strip that crosses every column cannot be a column.
 *
 * ## Why it is not a settings surface
 *
 * The workspace, step, context and elapsed cells are **readouts of state that already
 * exists**. They are spans, not buttons. The one control is the connection status: it
 * opens Settings → Engine, so Live is not a second panel fighting the layout toggles in
 * the title bar. The bar was requested as "a strip like VS Code's, in case we want to put
 * things here later" — that is an invitation to *add* items, not to ship empty
 * placeholders now, so each slot is filled or absent, never blank.
 *
 * ## Height
 *
 * 28px. This went 22 → 44 → 28, and both moves are worth recording because they are
 * opposite errors:
 *
 * - 22px was VS Code's own height, and at that size the strip reads as a *band* — a
 *   distinct zone of the window. Fine for a product with a status bar already in its
 *   vocabulary; too thin for one where the bar was just added.
 * - 44px was the user asking for the two window edges to match `TOP_BAR_H`. It was
 *   literally correct and it looked wrong: 44px of ambient readouts outweighs the 33px
 *   `ModeHeader` that carries the actual task lifecycle. The bottom edge had become the
 *   loudest thing on screen.
 *
 * 28px is the compromise — clearly a strip, clearly subordinate. The rule it encodes:
 * **this bar is ambient, so it must never out-weigh the header that shows real state.**
 * Matching the top bar is the right instinct when two bars carry the same kind of
 * information; these two do not.
 *
 * It is also the window's bottom-most element, where a Tauri resize edge lives — so the
 * resize handles in `WindowEdges` are raised above it rather than covered by it.
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { basename, count } from '../lib/format.js';
import { CONNECTION_META, TONE_TEXT } from '../lib/status.js';
import { t } from '../i18n/strings.js';
import { makeCommand } from '../state/store.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { pickFolder } from '../window/pick-folder.js';
import { Icon, StatusDot } from './primitives.js';

/**
 * Strip height in px. Shared with `App`'s `--status-bar-h` so the grid padding and the
 * bar cannot disagree about how much room the strip takes.
 *
 * 28px, and deliberately *not* `TOP_BAR_H`. See the module note: the two window edges
 * carry different kinds of information, and matching their heights made the ambient one
 * louder than the one showing the task lifecycle.
 *
 * 12px text in 28px is the ratio VS Code uses (11px in 22px), so the cells kept their
 * type scale from the 44px round. Only the height moved back down — a bar that is too
 * thin is a layout problem, while text too small for its bar is a legibility one.
 */
export const STATUS_BAR_H = 28;

const ITEM =
  'inline-flex shrink-0 items-center gap-1.5 px-2.5 text-[12px] text-ink-2 transition-colors hover:bg-hover hover:text-ink';

/**
 * One cell. A `<span>`, not a `<button>`: every item here is a readout, and a control that
 * does nothing is worse than no control at all.
 */
function Cell({
  children,
  title,
  testId,
}: {
  children: ReactNode;
  title?: string;
  testId?: string;
}): ReactNode {
  return (
    <span className={ITEM} title={title} data-status-item={testId}>
      {children}
    </span>
  );
}

function WorkspaceCell({
  workspace,
  tr,
}: {
  workspace: string | undefined;
  tr: (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => string;
}): ReactNode {
  const query = useUiStore((s) => s.query);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(workspace ?? '');
  const [note, setNote] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setPath(workspace ?? '');
  }, [open, workspace]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const apply = (): void => {
    const next = path.trim();
    if (!next) return;
    void query<{ ok?: boolean; workspace?: string; error?: string }>(makeCommand('set_workspace', { path: next }))
      .then((res) => {
        if (res && 'ok' in res && res.ok === false) {
          setNote(res.error === 'busy' ? tr('workspace.busy') : tr('workspace.invalid'));
          return;
        }
        setNote(null);
        setOpen(false);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setNote(message.includes('busy') || message.includes('进行') ? tr('workspace.busy') : tr('workspace.invalid'));
      });
  };

  return (
    <div ref={boxRef} className="relative min-w-0">
      <button
        type="button"
        className={ITEM}
        title={workspace ?? tr('statusBar.noWorkspace')}
        data-status-item="workspace"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="folder" size={13} className="shrink-0 text-ink-3" />
        <span className="max-w-[240px] truncate">{workspace ? basename(workspace) : tr('statusBar.noWorkspace')}</span>
      </button>
      {open ? (
        <div
          data-workspace-picker
          role="dialog"
          aria-label={tr('workspace.change')}
          className="absolute bottom-full left-1 z-40 mb-1 w-[280px] rounded-lg border border-line bg-elevated p-2 shadow-lg"
        >
          <p className="px-0.5 text-[12px] font-medium text-ink">{tr('workspace.change')}</p>
          <label className="mt-2 block text-[11px] text-ink-3">
            {tr('workspace.path')}
            <input
              data-workspace-path
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                apply();
              }}
              className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1 font-mono text-[12px] text-ink outline-none"
              spellCheck={false}
            />
          </label>
          {note ? <p className="mt-1.5 text-[11.5px] text-warn">{note}</p> : null}
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              data-workspace-browse
              className="rounded px-2 py-1 text-[11.5px] text-ink-2 hover:bg-hover hover:text-ink"
              onClick={() => {
                void pickFolder().then((picked) => {
                  if (picked) setPath(picked);
                });
              }}
            >
              {tr('workspace.browse')}
            </button>
            <button
              type="button"
              data-workspace-apply
              className="rounded bg-accent px-2 py-1 text-[11.5px] font-medium text-white hover:bg-accent-2"
              onClick={apply}
            >
              {tr('workspace.apply')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function StatusBar(): ReactNode {
  const { snapshot, status, setSettingsOpen } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  // Two shapes, because two callers: plain lookups take one argument, the two interpolated
  // tooltips below need their substitutions forwarded. Narrowing `tr` to one parameter is
  // what silently dropped them the first time.
  const tr = (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(language, k, params);

  const task = snapshot.task;
  const workspace = snapshot.session?.workspace;
  const done = task ? task.steps.filter((s) => s.status === 'done').length : 0;
  const connection = CONNECTION_META[status];
  const connectionLabel =
    status === 'live'
      ? 'Live'
      : status === 'connecting'
        ? tr('provider.connecting')
        : status === 'offline'
          ? 'Offline'
          : connection.label;

  return (
    <footer
      className="camelia-statusbar absolute inset-x-0 bottom-0 z-30 flex items-center border-t border-line bg-base"
      style={{
        ['--status-bar-h' as string]: `${STATUS_BAR_H}px`,
        height: STATUS_BAR_H,
      }}
      data-status-bar
      aria-label={tr('statusBar.label')}
    >
      {/* Left: where this run is pointed. */}
      <div className="flex min-w-0 shrink items-center">
        <WorkspaceCell workspace={workspace} tr={tr} />

        {/*
          Steps, while there is a task. `stepsTotal` can exceed `done` mid-run, and the
          ratio is the honest reading — "2/5" rather than a percentage, because the
          weighting behind `progress` is not something this strip should re-explain.
        */}
        {task ? (
          <Cell testId="steps" title={tr('statusBar.stepsHint', { done: String(done), total: String(task.stepsTotal) })}>
            <Icon name="check" size={13} className="shrink-0 text-ink-3" />
            <span className="font-mono tabular-nums">
              {done}/{task.stepsTotal}
            </span>
          </Cell>
        ) : null}

        {/*
          Context spend. This is the one number here that decides whether the *next* step
          can happen, so it earns a permanent slot rather than living only in the right
          rail — which is a panel the user can close, and which problem 4 removes.
        */}
        {task ? (
          <Cell
            testId="context"
            title={tr('statusBar.contextHint', {
              used: count(task.context.used),
              window: count(task.context.window),
            })}
          >
            <Icon name="gauge" size={13} className="shrink-0 text-ink-3" />
            <span className="font-mono tabular-nums">
              {count(task.context.used)}/{count(task.context.window)}
            </span>
          </Cell>
        ) : null}
      </div>

      {/* Right: the elapsed clock, the one thing a reader glances at to answer
          "how long has this been going". Sits at the far edge because it is the item
          whose position users expect to be fixed. */}
      <div className="ml-auto flex shrink-0 items-center">
        <button
          type="button"
          data-status-item="connection"
          data-connection-status={status}
          title={tr('connection.panel')}
          className={`${ITEM} ${TONE_TEXT[connection.tone]}`}
          onClick={() => setSettingsOpen(true, 'engine')}
        >
          <StatusDot tone={connection.tone} pulse={status === 'live' || status === 'connecting'} />
          <span>{connectionLabel}</span>
        </button>
        {task ? (
          <Cell testId="elapsed" title={tr('statusBar.elapsedHint')}>
            <Icon name="clock" size={13} className="shrink-0 text-ink-3" />
            <span className="font-mono tabular-nums" data-status-elapsed>
              {formatElapsed(task.updatedAt - task.startedAt)}
            </span>
          </Cell>
        ) : null}
      </div>
    </footer>
  );
}

/**
 * Elapsed run time as `m:ss`, or `h:mm:ss` past an hour.
 *
 * Seconds are omitted below a minute on purpose: a task that has been going 4s has not
 * reached a granularity anyone plans around, and a ticking `0:04` on a strip this size
 * reads as a clock that is not keeping time. The value comes from event timestamps, not a
 * wall clock, so it only changes when the run actually progresses — deterministic, which
 * is the same property the activity bar's elapsed times have.
 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (total < 60) return `${seconds}s`;
  if (hours === 0) return `${minutes}:${pad(seconds)}`;
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}