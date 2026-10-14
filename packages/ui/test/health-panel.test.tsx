import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ProjectionSnapshot } from '@camelia/agent/view';

import { HealthMetricsPanel } from '../src/components/HealthMetricsPanel.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';

describe('HealthMetricsPanel', () => {
  it('renders system tier and expands diagnostics', () => {
    const transport = new FixtureTransport({ scene: 'running' });
    const store = createUiStore(transport);
    const { container } = render(
      <UiProvider store={store}>
        <HealthMetricsPanel />
      </UiProvider>,
    );
    expect(container.querySelector('[data-panel-health]')).not.toBeNull();
    expect(container.querySelector('[data-health-diagnostics]')).toBeNull();
    fireEvent.click(container.querySelector('[data-health-diagnostics-toggle]') as HTMLElement);
    expect(container.querySelector('[data-health-diagnostics]')).not.toBeNull();
  });

  it('reads cognition.advice and keeps diagnostics collapsed until click', () => {
    const store = createUiStore(new FixtureTransport({ scene: 'empty' }));
    const snapshot: ProjectionSnapshot = {
      ...store.getState().snapshot,
      cognition: {
        predictions: [],
        surprises: [],
        skipped: [],
        competence: [],
        strategies: [],
        advise: {
          metrics: {
            health: { gatePassRate: 0.5, residualDistribution: { test: 2 }, gateRaisesAuto: 1, gateRaisesManual: 0 },
            diagnostic: { routerHitsA: 4, routerHitsB: 1, translateRejectRate: 0.25, skillRecordsToday: 3 },
            trust: { level: 'L2', mode: 'manual', successStreak: 1 },
          },
          latest: { id: 'advise-1', disposition: 'pending_human', errorClass: 'test', gate: 'L2', gateMode: 'manual', at: 1 },
        },
      },
    };
    store.setState({ snapshot });
    const { container } = render(
      <UiProvider store={store}>
        <HealthMetricsPanel />
      </UiProvider>,
    );
    expect(container.querySelector('[data-health-metric="人闸通过率"] dd')?.textContent).toBe('50%');
    expect(container.querySelector('[data-health-metric="残差信号"] dd')?.textContent).toBe('test 2');
    expect(container.querySelector('[data-health-metric="升闸次数"] dd')?.textContent).toBe('1+0');
    expect(container.querySelector('[data-health-metric="信任窗口"] dd')?.textContent).toBe('L2 · manual · 1');
    expect(container.querySelector('[data-health-diagnostics]')).toBeNull();
    fireEvent.click(container.querySelector('[data-health-diagnostics-toggle]') as HTMLElement);
    const diagnostics = container.querySelector('[data-health-diagnostics]');
    expect(diagnostics?.textContent).toContain('4');
    expect(diagnostics?.textContent).toContain('25%');
    expect(diagnostics?.textContent).toContain('3');
  });

  it('renders an em dash when the advise pass rate has no denominator', () => {
    const store = createUiStore(new FixtureTransport({ scene: 'empty' }));
    const snapshot: ProjectionSnapshot = {
      ...store.getState().snapshot,
      cognition: {
        predictions: [],
        surprises: [],
        skipped: [],
        competence: [],
        strategies: [],
        advise: {
          metrics: {
            health: { gatePassRate: null, residualDistribution: {}, gateRaisesAuto: 0, gateRaisesManual: 0 },
            diagnostic: { routerHitsA: 0, routerHitsB: 0, translateRejectRate: null, skillRecordsToday: 0 },
            trust: { level: 'L2', mode: 'auto', successStreak: 0 },
          },
          latest: { id: 'advise-0', disposition: 'rejected', errorClass: 'test', gate: 'L2', gateMode: 'auto', at: 1 },
        },
      },
    };
    store.setState({ snapshot });
    const { container } = render(
      <UiProvider store={store}>
        <HealthMetricsPanel />
      </UiProvider>,
    );
    expect(container.querySelector('[data-health-metric="人闸通过率"] dd')?.textContent).toBe('—');
  });
});
