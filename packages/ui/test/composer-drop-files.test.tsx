/**
 * Composer accepts folder + common non-image file drops as paths.
 * @module
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';

function renderEmpty() {
  const transport = new FixtureTransport({ scene: 'empty' });
  const store = createUiStore(transport);
  const view = render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  return view;
}

describe('composer drop — files and folders', () => {
  it('inserts an absolute file path into the textarea', () => {
    const { container } = renderEmpty();
    const card = container.querySelector('[data-composer]') as HTMLElement;
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'path', { value: 'C:\\\\Users\\\\me\\\\Desktop\\\\notes.md' });
    const dataTransfer = {
      types: ['Files'],
      items: [
        {
          kind: 'file',
          type: 'text/markdown',
          getAsFile: () => file,
          webkitGetAsEntry: () => ({ isDirectory: false, isFile: true, name: 'notes.md' }),
        },
      ],
      files: [file],
    };
    fireEvent.dragOver(card, { dataTransfer });
    fireEvent.drop(card, { dataTransfer });
    const area = container.querySelector('[data-composer] textarea') as HTMLTextAreaElement;
    expect(area.value).toContain('notes.md');
  });

  it('attaches a dropped folder chip and path text', () => {
    const { container } = renderEmpty();
    const card = container.querySelector('[data-composer]') as HTMLElement;
    const file = new File([''], 'camelia-bench');
    Object.defineProperty(file, 'path', { value: 'C:\\\\Users\\\\me\\\\Desktop\\\\camelia-bench' });
    Object.defineProperty(file, 'type', { value: '' });
    const entry = { isDirectory: true, isFile: false, name: 'camelia-bench', fullPath: '/camelia-bench' };
    const dataTransfer = {
      types: ['Files'],
      items: [
        {
          kind: 'file',
          type: '',
          getAsFile: () => file,
          webkitGetAsEntry: () => entry,
        },
      ],
      files: [file],
    };
    fireEvent.drop(card, { dataTransfer });
    expect(container.querySelector('[data-composer-folder="camelia-bench"]')).not.toBeNull();
  });
});
