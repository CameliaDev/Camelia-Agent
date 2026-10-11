/**
 * Goal-drift detection.
 *
 * Three cheap, model-free signals combined into one score (whitepaper §4.1):
 *  - intent similarity: does recent output still talk about the goal?
 *  - file-set distance: are we touching the files the plan said we would?
 *  - no-progress streak: how long since an acceptance point advanced?
 * @module
 */

const WEIGHTS = { intent: 0.4, files: 0.4, progress: 0.2 } as const;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
  'be', 'this', 'that', 'it', 'as', 'at', 'by', 'from', 'into', 'add', 'make',
]);

export interface DriftInput {
  /** Clarified goal, one sentence. */
  goal: string;
  /** Recent model output / step summary. */
  currentOutput: string;
  /** Paths the plan declared it would touch. */
  expectedPaths: string[];
  /** Paths actually touched so far. */
  touchedPaths: string[];
  /** Consecutive steps with no acceptance progress. */
  noProgressStreak: number;
}

export interface DriftAssessment {
  score: number;
  drifted: boolean;
  signals: string[];
  components: { intent: number; files: number; progress: number };
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export class DriftDetector {
  constructor(private readonly threshold: number = 0.45) {}

  assess(input: DriftInput): DriftAssessment {
    const signals: string[] = [];

    const intentSimilarity = jaccard(tokenize(input.goal), tokenize(input.currentOutput));
    const intentComponent = 1 - intentSimilarity;
    if (intentComponent > 0.75) {
      signals.push(`recent output barely overlaps the goal (similarity ${intentSimilarity.toFixed(2)})`);
    }

    let filesComponent = 0;
    const expectedFiles = input.expectedPaths.filter((p) => p !== '.');
    if (expectedFiles.length > 0) {
      const expected = new Set(expectedFiles);
      const touched = new Set(input.touchedPaths);
      const overlap = [...touched].filter((p) => expected.has(p)).length;
      const union = new Set([...expected, ...touched]).size;
      filesComponent = union === 0 ? 0 : 1 - overlap / union;
      if (filesComponent > 0.7) {
        signals.push('touched files diverge from the planned file set');
      }
    }

    const progressComponent = Math.min(1, input.noProgressStreak / 3);
    if (input.noProgressStreak >= 2) {
      signals.push(`${input.noProgressStreak} consecutive steps without acceptance progress`);
    }

    const score =
      WEIGHTS.intent * intentComponent +
      WEIGHTS.files * filesComponent +
      WEIGHTS.progress * progressComponent;

    return {
      score: Number(score.toFixed(4)),
      drifted: score >= this.threshold,
      signals,
      components: {
        intent: Number(intentComponent.toFixed(4)),
        files: Number(filesComponent.toFixed(4)),
        progress: Number(progressComponent.toFixed(4)),
      },
    };
  }
}