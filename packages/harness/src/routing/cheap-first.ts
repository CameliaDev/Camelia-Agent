/**
 * Cheap-first model choice inside the existing fix retry.
 *
 * Attempt 0 follows the difficulty score. Later attempts override that choice:
 * attempt 1 uses the decision model, attempt 2 uses it again with a longer
 * reflection. A cost ceiling forces every later attempt back onto the grunt
 * model instead of failing the task.
 * @module
 */

/** Named threshold. A step at or above this starts on the decision model. */
export const DIFFICULTY_THRESHOLD = 0.5;

/** USD per million tokens. Unknown models use `default`. */
export const MODEL_PRICE_PER_MILLION: Record<string, number> = {
  default: 0.5,
};

export function difficultyScore(input: {
  weight: number;
  inDegree: number;
  fileCount: number;
  historicalFailures: number;
}): number {
  const weight = Math.min(1, input.weight / 5) * 0.4;
  const incoming = Math.min(1, input.inDegree / 3) * 0.2;
  const files = Math.min(1, input.fileCount / 4) * 0.2;
  const history = Math.min(1, input.historicalFailures / 3) * 0.2;
  return weight + incoming + files + history;
}

export function estimateUsd(tokens: number, model?: string): number {
  const price = MODEL_PRICE_PER_MILLION[model ?? ''] ?? MODEL_PRICE_PER_MILLION.default ?? 0.5;
  return (tokens / 1_000_000) * price;
}

export function modelForAttempt(
  attempt: number,
  models: { decision: string; grunt: string },
  difficulty: number,
  overBudget: boolean,
): { model: string; reflect: boolean; reason: string } {
  const grunt = models.grunt || models.decision;
  if (overBudget) {
    return { model: grunt, reflect: false, reason: 'maxCostPerTask reached — staying on the grunt model' };
  }
  if (attempt <= 0) {
    if (difficulty >= DIFFICULTY_THRESHOLD) {
      return {
        model: models.decision,
        reflect: false,
        reason: `difficulty ${difficulty.toFixed(2)} is at least ${DIFFICULTY_THRESHOLD} — decision model`,
      };
    }
    return {
      model: grunt,
      reflect: false,
      reason: `attempt 0 — grunt model (difficulty ${difficulty.toFixed(2)} below ${DIFFICULTY_THRESHOLD})`,
    };
  }
  if (attempt === 1) {
    return { model: models.decision, reflect: false, reason: 'attempt 1 — decision model' };
  }
  return { model: models.decision, reflect: true, reason: 'attempt 2 — decision model with a longer reflection' };
}
