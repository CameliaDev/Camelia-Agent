/**
 * Right-rail observability — v8 two-tier layout (ARCH-Camelia-v8 §2.1).
 *
 * Top: system health (always visible). Bottom: diagnostics (collapsed by default).
 * When `cognition.advice` is present the rows read that snapshot. Otherwise the
 * panel keeps the stage-23 stub metrics so an empty run still has a health view.
 * @module
 */

import { useState, type ReactNode } from 'react';

import type { CognitionView, ProjectionSnapshot } from '@camelia/agent/view';
import type { AdviseMetricsSnapshot } from '@camelia/core';

import { pct } from '../lib/format.js';
import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { Icon, SectionHeader } from './primitives.js';

function metric(snapshot: ProjectionSnapshot, key: string, fallback = 0): number {
  const v = snapshot.metrics[key];
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

function residualSpread(cognition?: CognitionView): { surprises: number; competence: number } {
  if (!cognition) return { surprises: 0, competence: 0 };
  return { surprises: cognition.surprises.length, competence: cognition.competence.length };
}

function rateOrDash(value: number | null): string {
  if (value === null) return '—';
  return pct(value);
}

function distribution(rows: Readonly<Record<string, number>>): string {
  const entries = Object.entries(rows);
  if (entries.length === 0) return '—';
  return entries.map(([key, count]) => `${key} ${count}`).join(', ');
}

function HealthRow({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1" data-health-metric={label}>
      <dt className="min-w-0 truncate text-[11px] text-ink-2" title={hint}>{label}</dt>
      <dd className="shrink-0 font-mono text-[11.5px] text-ink">{value}</dd>
    </div>
  );
}

export function HealthMetricsPanel(): ReactNode {
  const snapshot = useUiStore((s) => s.snapshot);
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [diagOpen, setDiagOpen] = useState(false);

  const cognition = snapshot.cognition;
  const advise: AdviseMetricsSnapshot | undefined = cognition?.advise?.metrics;
  const residual = residualSpread(cognition);

  const humanGatePass = advise ? advise.health.gatePassRate : metric(snapshot, 'human_gate.pass_rate', 1);
  const escalations = advise
    ? `${advise.health.gateRaisesAuto}+${advise.health.gateRaisesManual}`
    : String(metric(snapshot, 'human_gate.escalations'));
  const residualValue = advise
    ? distribution(advise.health.residualDistribution)
    : `${residual.surprises} / ${residual.competence}`;
  const routerA = advise ? advise.diagnostic.routerHitsA : metric(snapshot, 'router.track_a_hits');
  const routerB = advise ? advise.diagnostic.routerHitsB : metric(snapshot, 'router.track_b_hits');
  const translateReject = advise ? advise.diagnostic.translateRejectRate : metric(snapshot, 'translate.reject_rate');
  const skillDaily = advise
    ? advise.diagnostic.skillRecordsToday
    : metric(snapshot, 'skillrecord.daily_added', cognition?.strategies.length ?? 0);

  return (
    <div data-panel-health className="space-y-0">
      <section className="border-b border-line">
        <SectionHeader icon="gauge" title={tr('health.tier.system')} />
        <dl className="space-y-0 px-3 pb-3">
          <HealthRow
            label={tr('health.humanGatePass')}
            value={rateOrDash(humanGatePass)}
            hint={tr('health.humanGatePass.hint')}
          />
          <HealthRow
            label={tr('health.residualSpread')}
            value={residualValue}
            hint={tr('health.residualSpread.hint')}
          />
          <HealthRow label={tr('health.escalations')} value={escalations} />
          {advise ? (
            <HealthRow
              label={tr('health.trust')}
              value={`${advise.trust.level} · ${advise.trust.mode} · ${advise.trust.successStreak}`}
            />
          ) : null}
        </dl>
      </section>

      <section className="border-b border-line">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover"
          data-health-diagnostics-toggle
          aria-expanded={diagOpen}
          onClick={() => setDiagOpen((v) => !v)}
        >
          <Icon
            name="chevron"
            size={12}
            className={`shrink-0 text-ink-3 transition-transform ${diagOpen ? 'rotate-90' : ''}`}
          />
          <span className="text-[11.5px] font-medium text-ink-2">{tr('health.tier.diagnostics')}</span>
        </button>
        {diagOpen ? (
          <dl className="space-y-0 px-3 pb-3" data-health-diagnostics>
            <HealthRow label={tr('health.routerA')} value={String(routerA)} />
            <HealthRow label={tr('health.routerB')} value={String(routerB)} />
            <HealthRow label={tr('health.translateReject')} value={rateOrDash(translateReject)} />
            <HealthRow label={tr('health.skillDaily')} value={String(skillDaily)} />
            {cognition?.skipped.length ? (
              <HealthRow label={tr('health.cognitionSkipped')} value={String(cognition.skipped.length)} />
            ) : null}
          </dl>
        ) : null}
      </section>
    </div>
  );
}
