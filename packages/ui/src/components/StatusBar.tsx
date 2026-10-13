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
 * Every item here is a **readout of state that already exists**: the workspace the engine
 * was pointed at, how far the task has got, how much context it has spent. Nothing is a
 * toggle that pretends to do something. The bar was requested as "a strip like VS Code's,
 * in case we want to put things here later" — that is an invitation to *add* items, not
 * to ship empty placeholders now, so each slot is filled or absent, never blank.
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

import type { ReactNode } from 'react';

import { basename, count } from '../lib/format.js';
import { t } from '../i18n/strings.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { Icon } from './primitives.js';

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

export function StatusBar(): ReactNode {
  const { snapshot } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  // Two shapes, because two callers: plain lookups take one argument, the two interpolated
  // tooltips below need their substitutions forwarded. Narrowing `tr` to one parameter is
  // what silently dropped them the first time.
  const tr = (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(language, k, params);

  const task = snapshot.task;
  const workspace = snapshot.session?.workspace;
  const done = task ? task.steps.filter((s) => s.status === 'done').length : 0;

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
        <Cell testId="workspace" title={workspace ?? tr('statusBar.noWorkspace')}>
          <Icon name="folder" size={13} className="shrink-0 text-ink-3" />
          {/* The tail is what identifies a workspace; the full path is in the tooltip,
              because a path long enough to be useful is too long for a 22px strip. */}
          <span className="max-w-[240px] truncate">{workspace ? basename(workspace) : tr('statusBar.noWorkspace')}</span>
        </Cell>

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