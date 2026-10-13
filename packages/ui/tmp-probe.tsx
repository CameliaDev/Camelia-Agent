import { render } from '@testing-library/react';
import { App } from './src/App.js';
import { createUiStore } from './src/state/store.js';
import { UiProvider } from './src/state/UiProvider.js';
import { FixtureTransport } from './src/transport/fixture.js';

const transport = new FixtureTransport({ scene: 'running' });
const store = createUiStore(transport);
const { container } = render(<UiProvider store={store}><App /></UiProvider>);
const checks = [
  'data-task-run-card',
  'data-conversation',
  'data-chat-transcript',
  'data-mode-shell',
  'data-collapsible',
];
for (const c of checks) {
  console.log(c, container.querySelector(`[${c}]`) ? 'YES' : 'NO', container.querySelector(`[${c}]`)?.getAttribute(c));
}
console.log('task', store.getState().snapshot.task?.id, 'steps', store.getState().snapshot.task?.steps?.length);
console.log('text sample', (container.textContent || '').slice(0, 500));
