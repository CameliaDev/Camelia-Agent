/**
 * Math mode — one chat timeline, with stage chips as progress only.
 *
 * Model, solve, and validation outputs live in the artifacts drawer
 * (`MathArtifactBody`), not in a second column beside the conversation.
 * The engine still has no math commands, so the demo stays an explicit,
 * labelled load and never starts by itself.
 * @module
 */

import { useEffect, type ReactNode } from 'react';

import { t } from '../../i18n/strings.js';
import { deriveProgress } from '../../progress/deriveProgress.js';
import { useUiState, useUiStore } from '../../state/UiProvider.js';
import { canIntervene, interveneUnavailableReason } from '../../window/capabilities.js';
import { Icon } from '../../components/primitives.js';
import { isFreshChatSession } from '../../state/fresh-session.js';
import { ChatTranscript } from '../chat/ChatTranscript.js';
import { MATH_STAGES, stageIndex } from './mathStageMap.js';
import { MATH_DEMO_FRAMES, MATH_DEMO_FIRST, type MathDemoSnapshot } from './mathDemoFixture.js';

/** How long each demo frame holds. Deterministic data, timed walk. */
const FRAME_MS = 900;

export function MathWorkspace(): ReactNode {
  const { snapshot, mathDemo, setMathDemo, setPanelId, transportError } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(language, k, params);
  const task = snapshot.task;
  const demoMode = mathDemo !== undefined;
  const shown: MathDemoSnapshot | undefined = mathDemo;
  const fresh = isFreshChatSession(snapshot) && !transportError;

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

  const solveOk = canIntervene('math_solve');
  const solveReason = interveneUnavailableReason('math_solve') || tr('mode.math.unavailable');

  const loadDemo = (): void => {
    setMathDemo(MATH_DEMO_FIRST);
    setPanelId('artifacts');
  };
  const clearDemo = (): void => {
    setMathDemo(undefined);
  };

  return (
    <div
      className={fresh ? 'flex shrink-0 flex-col' : 'flex min-h-0 flex-1 flex-col'}
      data-math-workspace
      data-demo={demoMode ? 'true' : undefined}
    >
      <div data-math-progress className="flex shrink-0 items-center gap-2 px-4 py-1.5">
        <ol className="flex min-w-0 shrink items-center gap-1" data-math-stages>
          {MATH_STAGES.map((spec, idx) => {
            const reached = idx <= activeIdx;
            const current = idx === activeIdx;
            return (
              <li key={spec.id}>
                <span
                  data-math-stage={spec.id}
                  data-math-current={current ? 'true' : undefined}
                  title={tr(spec.hintKey as Parameters<typeof t>[1])}
                  className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] leading-4 ${
                    current ? 'font-medium text-ink' : reached ? 'text-ink-2' : 'text-ink-3/70'
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
          className="min-w-0 truncate font-mono text-[10px] text-ink-3"
          title={tr('math.stage.pipeline', { index: activeIdx + 1 })}
        >
          {shown ? shown.engineStepHint : tr('math.stage.pipeline', { index: activeIdx + 1 })}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {demoMode ? (
            <>
              <span className="text-[10px] font-medium tracking-wide text-warn" data-math-demo-badge>
                {tr('math.demo.badge')}
              </span>
              <button
                type="button"
                data-math-demo-reload
                className="rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
                onClick={loadDemo}
              >
                {tr('math.demo.reload')}
              </button>
              <button
                type="button"
                data-math-demo-clear
                className="rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
                onClick={clearDemo}
              >
                {tr('math.demo.clear')}
              </button>
            </>
          ) : (
            <button
              type="button"
              data-math-demo-load
              className="rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
              onClick={loadDemo}
            >
              {tr('math.demo.load')}
            </button>
          )}
          <span
            data-math-solve-disabled={solveOk ? undefined : 'true'}
            title={solveOk ? undefined : solveReason}
            aria-disabled={solveOk ? undefined : true}
            className={`inline-flex items-center gap-1 text-[11px] ${
              solveOk ? 'text-ink-2' : 'cursor-not-allowed text-ink-3/60'
            }`}
          >
            <Icon name="play" size={11} />
            {tr('math.stage.run')}
          </span>
        </span>
      </div>

      <p data-math-unavailable className="shrink-0 px-4 pb-1 text-[11px] leading-5 text-ink-3">
        {tr('math.unavailable.body')}
      </p>

      {fresh ? null : <ChatTranscript />}
    </div>
  );
}
