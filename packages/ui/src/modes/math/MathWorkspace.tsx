/**
 * Math mode — the differentiated surface.
 *
 * ## What is real here
 *
 * The four-stage strip is real: it maps onto the engine's eight-step pipeline in
 * `mathStageMap.ts`, and it drives off the same `deriveProgress` the top bar uses. The
 * panels, the stage semantics and the empty states are all product, not mock-up.
 *
 * ## What is not
 *
 * There are no `math.*` commands in the engine (`EngineServer` handles none), so a live
 * modeling session cannot be started. The demo is therefore **explicitly loaded by the
 * user** — it never auto-plays on entering the mode, because an animation that starts by
 * itself reads as "the solver is connected". While it is showing, the mode header carries
 * a 演示 badge and every derived value is labelled.
 *
 * The one thing this file must never do is let a screenshot of the demo pass for a working
 * solver. That is why `demoMode` gates the badge *and* the data, together, in one place.
 * @module
 */

import { useEffect, type ReactNode } from 'react';

import { t } from '../../i18n/strings.js';
import { deriveProgress } from '../../progress/deriveProgress.js';
import { useUiState, useUiStore } from '../../state/UiProvider.js';
import { canIntervene, interveneUnavailableReason } from '../../window/capabilities.js';
import { Icon, SectionHeader } from '../../components/primitives.js';
import { MATH_STAGES, stageIndex } from './mathStageMap.js';
import { MATH_DEMO_FRAMES, MATH_DEMO_FIRST, type MathDemoSnapshot } from './mathDemoFixture.js';
import { AssumptionsPanel, EquationsPanel, ResultCards, SolverStatus, VariablesPanel } from './MathPanels.js';

/** How long each demo frame holds. Deterministic data, timed walk. */
const FRAME_MS = 900;

export function MathWorkspace(): ReactNode {
  const { snapshot, mathDemo, setMathDemo } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(language, k, params);
  const task = snapshot.task;
  const demoMode = mathDemo !== undefined;
  // The store owns the *current* demo frame, not this component. The top bar and the
  // activity bar both read `store.mathDemo` for their progress rail, so a frame index kept
  // in local state here would leave them showing frame 0 while the workspace advanced —
  // two disagreeing stages from what is meant to be one source.
  const shown: MathDemoSnapshot | undefined = mathDemo;

  // Walk the demo frames while it is loaded and still running. The frames are data, so
  // this effect only decides *when* the next one shows — a test can assert the sequence
  // without depending on wall-clock accuracy.
  useEffect(() => {
    if (!demoMode || !shown) return;
    const idx = MATH_DEMO_FRAMES.indexOf(shown);
    if (idx < 0 || idx >= MATH_DEMO_FRAMES.length - 1) return;
    const timer = window.setTimeout(() => setMathDemo(MATH_DEMO_FRAMES[idx + 1]), FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [demoMode, shown, setMathDemo]);

  const { progress } = deriveProgress({
    task,
    mode: 'math',
    language,
    ...(shown ? { mathDemo: shown } : {}),
  });
  const stage = progress.kind === 'math' ? progress.stage : 'modeling';
  const activeIdx = stageIndex(stage);

  // The engine cannot solve yet, so the solve control is disabled with the real reason
  // rather than silently doing nothing (the same pattern as honest intervene).
  const solveOk = canIntervene('math_solve');
  const solveReason = interveneUnavailableReason('math_solve') || tr('mode.math.unavailable');

  const loadDemo = (): void => {
    setMathDemo(MATH_DEMO_FIRST);
  };
  const clearDemo = (): void => {
    setMathDemo(undefined);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-math-workspace data-demo={demoMode ? 'true' : undefined}>
      {/* Stage strip + controls */}
      <div className="shrink-0 border-b border-line px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <ol className="flex flex-wrap items-center gap-1.5" data-math-stages>
            {MATH_STAGES.map((spec, idx) => {
              const reached = idx <= activeIdx;
              const current = idx === activeIdx;
              return (
                <li key={spec.id}>
                  <span
                    data-math-stage={spec.id}
                    data-math-current={current ? 'true' : undefined}
                    title={tr(spec.hintKey as Parameters<typeof t>[1])}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-[11px] ${
                      current
                        ? 'border-accent/50 bg-accent/12 font-medium text-accent'
                        : reached
                          ? 'border-line text-ink-2'
                          : 'border-line/60 text-ink-3/70'
                    }`}
                  >
                    <span className="font-mono text-[10px] opacity-70">{idx + 1}</span>
                    {tr(spec.labelKey as Parameters<typeof t>[1])}
                  </span>
                </li>
              );
            })}
          </ol>

          <span
            data-math-pipeline-hint
            className="font-mono text-[10px] text-ink-3"
            title={tr('math.stage.pipeline', { index: activeIdx + 1 })}
          >
            {shown ? shown.engineStepHint : tr('math.stage.pipeline', { index: activeIdx + 1 })}
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {demoMode ? (
              <>
                <span
                  data-math-demo-badge
                  className="rounded border border-warn/50 bg-warn/10 px-1.5 py-[2px] text-[10px] font-semibold tracking-wide text-warn"
                >
                  {tr('math.demo.badge')}
                </span>
                <button
                  type="button"
                  data-math-demo-reload
                  className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
                  onClick={loadDemo}
                >
                  {tr('math.demo.reload')}
                </button>
                <button
                  type="button"
                  data-math-demo-clear
                  className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
                  onClick={clearDemo}
                >
                  {tr('math.demo.clear')}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-math-demo-load
                className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/15"
                onClick={loadDemo}
              >
                {tr('math.demo.load')}
              </button>
            )}

            <span
              data-math-solve-disabled={solveOk ? undefined : 'true'}
              title={solveOk ? undefined : solveReason}
              aria-disabled={solveOk ? undefined : true}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                solveOk
                  ? 'cursor-pointer border-line text-ink-2 hover:border-accent/40 hover:text-accent'
                  : 'cursor-not-allowed border-line/60 text-ink-3/70'
              }`}
            >
              <Icon name="play" size={11} />
              {tr('math.stage.run')}
            </span>
          </div>
        </div>
      </div>

      {/* Honest banner: this build has no math backend. */}
      <div
        data-math-unavailable
        className="shrink-0 border-b border-warn/30 bg-warn/8 px-4 py-1.5 text-[11px] leading-5 text-warn"
      >
        <span className="font-medium">{tr('math.unavailable.title')}</span>
        <span className="ml-1.5 text-ink-2">{tr('math.unavailable.body')}</span>
      </div>

      {/* Empty state — the demo is opt-in, never automatic. */}
      {!demoMode && !task ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center" data-math-empty>
          <Icon name="sigma" size={24} className="text-ink-3" />
          <p className="mt-3 text-[13px] font-medium text-ink">{tr('math.empty.title')}</p>
          <p className="mt-1 max-w-sm text-[12px] leading-6 text-ink-3">{tr('math.empty.body')}</p>
          <button
            type="button"
            className="mt-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px] font-medium text-accent hover:bg-accent/15"
            onClick={loadDemo}
          >
            {tr('math.demo.load')}
          </button>
        </div>
      ) : (
        /* Two columns: model definition on the left, solve + results on the right. */
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          <div className="min-h-0 space-y-1 border-line lg:overflow-y-auto lg:border-r">
            <AssumptionsPanel
              live={task?.assumptions ?? []}
              demo={shown?.assumptions ?? []}
              demoMode={demoMode}
              language={language}
            />
            <VariablesPanel variables={shown?.variables ?? []} language={language} />
            <EquationsPanel equations={shown?.equations ?? []} language={language} />
          </div>
          <div className="flex min-h-0 flex-col">
            <SolverStatus
              status={shown?.status ?? 'idle'}
              log={shown?.solverLog ?? []}
              demoMode={demoMode}
              language={language}
            />
            <ResultCards results={shown?.results ?? []} demoMode={demoMode} language={language} />
            {demoMode ? (
              <p className="px-3 pb-3 text-[10.5px] leading-4 text-ink-3">{tr('math.demo.explain')}</p>
            ) : (
              <SectionHeader icon="info" title={tr('math.results.empty')} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
