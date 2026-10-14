/**
 * Cognition estimator (ARCH-COGNITION Phase 0–2).
 *
 * Pure functions, an in-memory backoff table, and the observe-only port.
 * The port records predictions. It does not call a model or change a plan.
 * @module
 */

export {
  DEFAULT_MIN_LEVEL_SAMPLES,
  DEFAULT_MIN_SAMPLES,
  DEFAULT_SURPRISE_PERCENTILE,
  DEFAULT_SURPRISE_WINDOW,
  binaryBrier,
  categoricalBrier,
  clamp01,
  contrastLine,
  decideSurprise,
  jaccardDistance,
  nrmse,
  percentileNearestRank,
  scoreValue,
} from './score.js';
export type { SurpriseInput } from './score.js';

export {
  backoffChain,
  buildSignature,
  capabilityClass,
  inDegreeOf,
  inferArchetype,
  inferScope,
  inferToolset,
  pathsInText,
  signatureKeyAt,
} from './signature.js';

export { coldStartPrior, durationPriorMs, toolCountPrior } from './prior.js';
export type { ColdPrior, PriorContext } from './prior.js';

export { BackoffTable } from './BackoffTable.js';
export type { BackoffHit, BackoffTableOptions } from './BackoffTable.js';

export { ObserveOnlyPolicy } from './CognitivePolicy.js';
export type { CognitivePolicy } from './CognitivePolicy.js';

export { CognitionService, acceptancePathsOf } from './CognitionService.js';
export type { CognitionServiceOptions } from './CognitionService.js';

export { formatBacktestReport, runCognitionBacktest } from './backtest.js';
export type {
  BacktestOptions,
  BacktestReport,
  KindSummary,
  LevelSummary,
  ReplayEvent,
} from './backtest.js';

export { syntheticCognitionCorpus } from './synthetic-corpus.js';
