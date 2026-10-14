import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
