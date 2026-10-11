/**
 * Plan review. Shown while a task is `awaiting-approval`.
 *
 * The right rail stays the execution view. This panel is the decision: each step
 * shows what it depends on, which path it will touch, and how it will be checked.
 * Edits stay in `awaiting-approval`; approve and reject leave it.
 * @module
 */

import { useState, type ReactNode } from 'react';

import type { PlanEdit } from '@camelia/core';
import type { TaskView } from '@camelia/agent/view';

import { makeCommand } from '../state/store.js';
import { useUiState } from '../state/UiProvider.js';

export function PlanReview({ task }: { task: TaskView }): ReactNode {
  const { dispatch } = useUiState();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftPath, setDraftPath] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const send = (edits: PlanEdit[]): void => {
    dispatch(makeCommand('edit_plan', { taskId: task.id, edits }));
  };

  const move = (stepId: string, direction: -1 | 1): void => {
    const ids = task.steps.map((step) => step.id);
    const index = ids.indexOf(stepId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    const reordered = ids.slice();
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(next, 0, moved);
    send([{ op: 'reorder', stepIds: reordered }]);
  };

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-plan-review>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Review the plan</h2>
          <p className="mt-0.5 text-[12px] text-ink-2">
            {task.goal ?? task.intentRaw}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className="rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-medium text-base"
            onClick={() => dispatch(makeCommand('approve_plan', { taskId: task.id, scope: 'once' }))}
          >
            Approve once
          </button>
          <button
            type="button"
            className="rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-ink"
            onClick={() => dispatch(makeCommand('approve_plan', { taskId: task.id, scope: 'session' }))}
          >
            Approve for session
          </button>
          <button
            type="button"
            className="rounded-md border border-bad/40 px-2.5 py-1.5 text-[11.5px] text-bad"
            onClick={() => setRejecting((value) => !value)}
          >
            Reject
          </button>
        </div>
      </div>

      {rejecting ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            dispatch(makeCommand('reject_plan', { taskId: task.id, reason: reason.trim() || 'rejected' }));
          }}
        >
          <input
            aria-label="Reject reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this plan should not run"
            className="min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
          />
          <button type="submit" className="rounded-md bg-bad/80 px-2.5 py-1.5 text-[11.5px] text-base">
            Cancel the task
          </button>
        </form>
      ) : null}

      <ol className="space-y-2">
        {task.steps.map((step, index) => {
          const path = step.acceptance.find((point) => point.path)?.path ?? '';
          const open = editing === step.id;
          return (
            <li key={step.id} className="rounded-lg border border-line bg-panel/60 px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 font-mono text-[11px] text-ink-3">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-ink">{step.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-2">{step.goal}</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-2">
                    path {path || '—'}
                    {step.deps?.length ? ` · depends on ${step.deps.join(', ')}` : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {step.acceptance.map((point) => (
                      <li key={`${step.id}-${point.kind}-${point.description}`} className="text-[11px] text-ink-3">
                        verify {point.kind}: {point.description}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`Move ${step.title} up`} className="rounded border border-line px-1.5 text-[11px] text-ink-2" onClick={() => move(step.id, -1)}>↑</button>
                  <button type="button" aria-label={`Move ${step.title} down`} className="rounded border border-line px-1.5 text-[11px] text-ink-2" onClick={() => move(step.id, 1)}>↓</button>
                  <button
                    type="button"
                    className="rounded border border-line px-1.5 text-[11px] text-ink-2"
                    onClick={() => {
                      setEditing(open ? null : step.id);
                      setDraftTitle(step.title);
                      setDraftPath(path);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${step.title}`}
                    className="rounded border border-line px-1.5 text-[11px] text-bad"
                    onClick={() => send([{ op: 'delete', stepId: step.id }])}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {open ? (
                <form
                  className="mt-2 grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const edits: PlanEdit[] = [];
                    if (draftTitle.trim() && draftTitle.trim() !== step.title) {
                      edits.push({ op: 'retitle', stepId: step.id, title: draftTitle.trim() });
                    }
                    if (draftPath.trim() && draftPath.trim() !== path) {
                      edits.push({ op: 'repath', stepId: step.id, path: draftPath.trim() });
                    }
                    if (edits.length) send(edits);
                    setEditing(null);
                  }}
                >
                  <input aria-label="Step title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className="rounded-md border border-line bg-base px-2 py-1 text-[12px] text-ink" />
                  <input aria-label="Step path" value={draftPath} onChange={(event) => setDraftPath(event.target.value)} className="rounded-md border border-line bg-base px-2 py-1 font-mono text-[12px] text-ink" />
                  <button type="submit" className="w-fit rounded-md border border-line px-2 py-1 text-[11.5px] text-ink">Save edit</button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="rounded-md border border-dashed border-line px-2.5 py-1.5 text-[11.5px] text-ink-2"
        onClick={() => send([{ op: 'insert', title: 'New step', path: '' }])}
      >
        Add step
      </button>
    </div>
  );
}
