/**
 * Apply a user's plan edits. Paths live on acceptance points (`params.path`).
 * @module
 */

import type { Plan, PlanEdit, Step } from '@camelia/core';
import { newId } from '@camelia/core';

export function applyPlanEdits(plan: Plan, edits: PlanEdit[]): Plan {
  let steps = plan.steps.map((step) => ({ ...step, acceptance: step.acceptance.map((point) => ({ ...point, params: { ...point.params } })) }));
  for (const edit of edits) {
    steps = applyOne(steps, edit, plan.taskId);
  }
  steps = steps.map((step, idx) => ({ ...step, idx }));
  return { ...plan, steps, revision: plan.revision + 1 };
}

function applyOne(steps: Step[], edit: PlanEdit, taskId: string): Step[] {
  if (edit.op === 'reorder') {
    const byId = new Map(steps.map((step) => [step.id, step]));
    const ordered = edit.stepIds.map((id) => byId.get(id)).filter((step): step is Step => step !== undefined);
    const rest = steps.filter((step) => !edit.stepIds.includes(step.id));
    return [...ordered, ...rest];
  }
  if (edit.op === 'insert') {
    const step: Step = {
      id: newId(),
      taskId,
      idx: steps.length,
      title: edit.title,
      goal: edit.title,
      status: 'pending',
      acceptance: edit.path
        ? [{ id: newId(), description: edit.path, kind: 'file-exists', params: { path: edit.path } }]
        : [],
      weight: 1,
      deps: [],
    };
    if (!edit.afterStepId) return [...steps, step];
    const at = steps.findIndex((item) => item.id === edit.afterStepId);
    if (at < 0) return [...steps, step];
    return [...steps.slice(0, at + 1), step, ...steps.slice(at + 1)];
  }
  return steps.flatMap((step) => {
    if (step.id !== edit.stepId) return [step];
    if (edit.op === 'delete') return [];
    if (edit.op === 'retitle') return [{ ...step, title: edit.title }];
    const acceptance = step.acceptance.length
      ? step.acceptance.map((point, index) => (index === 0 ? { ...point, params: { ...point.params, path: edit.path } } : point))
      : [{ id: newId(), description: edit.path, kind: 'file-exists' as const, params: { path: edit.path } }];
    return [{ ...step, acceptance }];
  });
}
