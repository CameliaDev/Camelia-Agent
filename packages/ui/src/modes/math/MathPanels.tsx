/**
 * Assumptions panel (math mode).
 *
 * Live data comes from `TaskView.assumptions` — a real `string[]` the projection carries
 * from `task.clarified`. The demo supplies its own list with confirmed/open states.
 *
 * The two are rendered distinctly on purpose: a live assumption has no "open/confirmed"
 * state (the engine does not emit one), so showing a chip there would be inventing
 * information. The chip appears only where the state genuinely exists.
 * @module
 */

import { type ReactNode } from 'react';

import { t } from '../../i18n/strings.js';
import type { LanguagePref } from '../../state/local-prefs.js';
import { useUiStore } from '../../state/UiProvider.js';
import type { MathDemoAssumption } from './mathDemoFixture.js';
import { SectionHeader } from '../../components/primitives.js';
import { canIntervene, interveneUnavailableReason } from '../../window/capabilities.js';

export function AssumptionsPanel({
  live,
  demo,
  demoMode,
  language,
}: {
  /** `TaskView.assumptions` — the engine's real list. */
  live: readonly string[];
  /** Demo assumptions, present only in demo mode. */
  demo: readonly MathDemoAssumption[];
  demoMode: boolean;
  language: LanguagePref;
}): ReactNode {
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const items: readonly MathDemoAssumption[] = demoMode
    ? demo
    : live.map((text) => ({ text, state: 'confirmed' as const }));

  return (
    <section data-math-panel="assumptions" className="flex min-h-0 flex-col">
      <SectionHeader icon="layers" title={tr('math.assumptions')} />
      {items.length === 0 ? (
        <p className="px-3 py-2 text-[11.5px] text-ink-3">—</p>
      ) : (
        <ul className="space-y-1.5 px-3 pb-3">
          {items.map((item, idx) => (
            <li key={`${idx}-${item.text}`} className="flex items-start gap-2">
              <span className="mt-[5px] shrink-0 font-mono text-[10px] text-ink-3">A{idx + 1}</span>
              <span className="min-w-0 flex-1 text-[11.5px] leading-5 text-ink-2">{item.text}</span>
              {/* The state chip is only meaningful for demo data: the engine has no
                  such field, so rendering it live would be a fabrication. */}
              {demoMode ? (
                <span
                  className={`shrink-0 rounded px-1.5 py-[1px] text-[10px] ${
                    item.state === 'confirmed'
                      ? 'border border-ok/40 bg-ok/10 text-ok'
                      : 'border border-warn/40 bg-warn/10 text-warn'
                  }`}
                >
                  {item.state === 'confirmed' ? tr('math.assumptions.confirmed') : tr('math.assumptions.pending')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Variables table. Symbol / name / unit / value / source, as the plan book specifies. */
export function VariablesPanel({
  variables,
  language,
}: {
  variables: readonly {
    symbol: string;
    name: string;
    unit: string;
    value: string;
    source: 'assumption' | 'fitted' | 'user' | 'derived';
  }[];
  language: LanguagePref;
}): ReactNode {
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const sourceLabel: Record<string, Parameters<typeof t>[1]> = {
    assumption: 'math.source.assumption',
    fitted: 'math.source.fitted',
    user: 'math.source.user',
    derived: 'math.source.derived',
  };

  return (
    <section data-math-panel="variables" className="flex min-h-0 flex-col">
      <SectionHeader icon="gauge" title={tr('math.variables')} />
      {variables.length === 0 ? (
        <p className="px-3 py-2 text-[11.5px] text-ink-3">—</p>
      ) : (
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.06em] text-ink-3">
                <th className="py-1 pr-2 font-medium">{tr('math.variables.symbol')}</th>
                <th className="py-1 pr-2 font-medium">{tr('math.variables.name')}</th>
                <th className="py-1 pr-2 font-medium">{tr('math.variables.unit')}</th>
                <th className="py-1 pr-2 text-right font-medium">{tr('math.variables.value')}</th>
                <th className="py-1 font-medium">{tr('math.variables.source')}</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((v) => (
                <tr key={v.symbol} className="border-t border-line/60">
                  <td className="py-1 pr-2 font-mono text-[11px] text-accent">{v.symbol}</td>
                  <td className="py-1 pr-2 text-ink-2">{v.name}</td>
                  <td className="py-1 pr-2 text-ink-3">{v.unit}</td>
                  <td className="py-1 pr-2 text-right font-mono text-ink">{v.value}</td>
                  <td className="py-1 text-[10.5px] text-ink-3">
                    {tr(sourceLabel[v.source] ?? 'math.source.derived')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Equations panel.
 *
 * Rendered read-only. Editing needs a place to *put* the edit (a model store on the
 * engine), and offering an editable textarea with nowhere to save it would be the same
 * dishonesty this codebase avoids elsewhere — so the edit affordance is a disabled
 * control with the real reason attached.
 */
export function EquationsPanel({
  equations,
  language,
}: {
  equations: readonly { text: string; note: string }[];
  language: LanguagePref;
}): ReactNode {
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  return (
    <section data-math-panel="equations" className="flex min-h-0 flex-col">
      <SectionHeader
        icon="sigma"
        title={tr('math.equations')}
        right={
          <span
            data-math-equations-readonly
            title={tr('math.equations.readonly')}
            className="cursor-not-allowed rounded border border-line px-1.5 py-[1px] text-[10px] text-ink-3/70"
          >
            {tr('math.equations.edit')}
          </span>
        }
      />
      {equations.length === 0 ? (
        <p className="px-3 py-2 text-[11.5px] text-ink-3">—</p>
      ) : (
        <ul className="space-y-1.5 px-3 pb-3">
          {equations.map((eq, idx) => (
            <li key={`${idx}-${eq.text}`} className="rounded border border-line/70 bg-base/50 px-2 py-1.5">
              <p className="font-mono text-[11.5px] text-ink">{eq.text}</p>
              {eq.note ? <p className="mt-0.5 text-[10.5px] text-ink-3">{eq.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Solver status + output tail.
 *
 * `math.exec` returns `{ script, stdout, stderr, figurePaths, timedOut }`, so when a live
 * run exists the log here is that stdout tail — the same bytes the tool produced, not a
 * paraphrase. In demo mode the log is labelled.
 */
export function SolverStatus({
  status,
  log,
  demoMode,
  language,
}: {
  status: 'idle' | 'running' | 'done' | 'failed';
  log: readonly string[];
  demoMode: boolean;
  language: LanguagePref;
}): ReactNode {
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const label =
    status === 'running'
      ? tr('math.solver.running')
      : status === 'failed'
        ? tr('math.solver.failed')
        : status === 'done'
          ? tr('math.solver.converged')
          : tr('math.solver.idle');
  const tone =
    status === 'running' ? 'text-accent' : status === 'failed' ? 'text-bad' : status === 'done' ? 'text-ok' : 'text-ink-3';

  return (
    <section data-math-panel="solver" className="flex min-h-0 flex-col">
      <SectionHeader
        icon="terminal"
        title={tr('math.solver')}
        right={
          <span className={`flex items-center gap-1.5 text-[11px] ${tone}`} data-math-solver-status={status}>
            <span className={`h-1.5 w-1.5 rounded-full ${status === 'running' ? 'bg-accent' : status === 'failed' ? 'bg-bad' : status === 'done' ? 'bg-ok' : 'bg-ink-3'}`} />
            {label}
          </span>
        }
      />
      <div className="min-h-0 flex-1 px-3 pb-3">
        <p className="mb-1 text-[10px] uppercase tracking-[0.06em] text-ink-3">{tr('math.solver.log')}</p>
        {log.length === 0 ? (
          <p className="text-[11.5px] text-ink-3">—</p>
        ) : (
          <pre
            data-math-solver-log
            className={`max-h-[160px] overflow-auto rounded border border-line/70 bg-base/60 px-2 py-1.5 font-mono text-[10.5px] leading-4 ${
              demoMode ? 'text-ink-3' : 'text-ink-2'
            }`}
          >
            {log.join('\n')}
          </pre>
        )}
      </div>
    </section>
  );
}

/**
 * Result cards.
 *
 * Export is disabled with a stated reason: there is no `math.export_report` command and no
 * report writer in the engine. A button that silently does nothing would be worse than a
 * button that says why it cannot.
 */
export function ResultCards({
  results,
  demoMode,
  language,
}: {
  results: readonly { label: string; value: string; unit?: string; hint?: string }[];
  demoMode: boolean;
  language: LanguagePref;
}): ReactNode {
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  // Honest gating, same table the solve control uses: no report writer exists on the
  // engine, so say that — rather than borrowing the equations panel's explanation.
  const exportOk = canIntervene('math_export_report');
  const exportReason = interveneUnavailableReason('math_export_report');

  return (
    <section data-math-panel="results" className="flex min-h-0 flex-col">
      <SectionHeader
        icon="ruler"
        title={tr('math.results')}
        right={
          <span
            data-math-export-disabled={exportOk ? undefined : 'true'}
            aria-disabled={exportOk ? undefined : true}
            title={exportOk ? undefined : exportReason}
            className={`rounded border border-line px-1.5 py-[1px] text-[10px] ${
              exportOk ? 'text-ink-2' : 'cursor-not-allowed text-ink-3/70'
            }`}
          >
            {tr('math.results.export')}
          </span>
        }
      />
      {results.length === 0 ? (
        <p className="px-3 py-2 text-[11.5px] text-ink-3">{tr('math.results.empty')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 px-3 pb-3">
          {results.map((card) => (
            <div
              key={card.label}
              data-math-result-card
              className={`rounded-lg border border-line bg-base/60 px-2.5 py-2 ${demoMode ? 'opacity-90' : ''}`}
            >
              <p className="text-[10.5px] text-ink-3">{card.label}</p>
              <p className="mt-0.5 font-mono text-[14px] font-semibold text-ink">
                {card.value}
                {card.unit ? <span className="ml-1 text-[10.5px] font-normal text-ink-3">{card.unit}</span> : null}
              </p>
              {card.hint ? <p className="mt-0.5 text-[10px] leading-4 text-ink-3">{card.hint}</p> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Model, solve, and validation outputs for the artifacts drawer.
 *
 * One list in one drawer — not a second workspace split into 建模 and 求解 rooms.
 */
export function MathArtifactBody(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const mathDemo = useUiStore((s) => s.mathDemo);
  const task = useUiStore((s) => s.snapshot.task);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const demoMode = mathDemo !== undefined;
  const live = task?.assumptions ?? [];

  if (!demoMode && live.length === 0) {
    return (
      <p className="px-1 py-2 text-[12px] text-ink-3" data-math-artifacts-empty>
        {tr('panel.artifacts.empty')}
      </p>
    );
  }

  return (
    <div data-math-artifacts className="space-y-1">
      {demoMode ? (
        <p className="px-3 pt-1 text-[10.5px] text-warn" data-math-demo-badge>
          {tr('math.demo.badge')}
        </p>
      ) : null}
      <AssumptionsPanel live={live} demo={mathDemo?.assumptions ?? []} demoMode={demoMode} language={language} />
      <VariablesPanel variables={mathDemo?.variables ?? []} language={language} />
      <EquationsPanel equations={mathDemo?.equations ?? []} language={language} />
      <SolverStatus
        status={mathDemo?.status ?? 'idle'}
        log={mathDemo?.solverLog ?? []}
        demoMode={demoMode}
        language={language}
      />
      <ResultCards results={mathDemo?.results ?? []} demoMode={demoMode} language={language} />
      {demoMode ? <p className="px-3 pb-2 text-[10.5px] leading-4 text-ink-3">{tr('math.demo.explain')}</p> : null}
    </div>
  );
}
