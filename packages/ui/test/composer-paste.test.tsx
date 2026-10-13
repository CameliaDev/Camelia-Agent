/**
 * Composer clipboard image paste — preview strip + chat_message images payload.
 * @module
 */

import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { createUiStore } from '../src/state/store.js';
import { UiProvider } from '../src/state/UiProvider.js';
import { FixtureTransport } from '../src/transport/fixture.js';

function renderEmpty() {
  const transport = new FixtureTransport({ scene: 'empty' });
  const store = createUiStore(transport);
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  const real = transport.send.bind(transport);
  transport.send = (cmd) => {
    sent.push(cmd as unknown as { type: string; payload: Record<string, unknown> });
    real(cmd);
  };
  const view = render(
    <UiProvider store={store}>
      <App />
    </UiProvider>,
  );
  return { ...view, store, sent };
}

function tinyPngFile(): File {
  // 1x1 PNG
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bin], 'dot.png', { type: 'image/png' });
}

describe('composer image paste', () => {
  it('shows a thumbnail after pasting an image and sends it on chat_message', async () => {
    const { container, sent } = renderEmpty();
    const area = container.querySelector('[data-composer] textarea') as HTMLTextAreaElement;
    expect(area).not.toBeNull();

    const file = tinyPngFile();
    const item = {
      kind: 'file',
      type: 'image/png',
      getAsFile: () => file,
    };

    await act(async () => {
      fireEvent.paste(area, {
        clipboardData: {
          items: [item],
          files: [file],
          types: ['Files'],
          getData: () => '',
        },
      });
      // FileReader is async
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(container.querySelector('[data-composer-images]')).not.toBeNull();
    expect(container.querySelectorAll('[data-composer-image]').length).toBe(1);

    await act(async () => {
      fireEvent.change(area, { target: { value: 'what is in this image?' } });
      fireEvent.keyDown(area, { key: 'Enter' });
    });

    const chat = sent.find((c) => c.type === 'chat_message');
    expect(chat).toBeTruthy();
    expect(chat!.payload.text).toBe('what is in this image?');
    const images = chat!.payload.images as { mimeType: string; dataBase64: string }[] | undefined;
    expect(images).toBeTruthy();
    expect(images!).toHaveLength(1);
    expect(images![0]!.mimeType).toBe('image/png');
    expect(images![0]!.dataBase64.length).toBeGreaterThan(20);
    // Preview cleared after send
    expect(container.querySelector('[data-composer-images]')).toBeNull();
  });

  it('removes a pending image from the strip', async () => {
    const { container } = renderEmpty();
    const area = container.querySelector('[data-composer] textarea') as HTMLTextAreaElement;
    const file = tinyPngFile();

    await act(async () => {
      fireEvent.paste(area, {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
          files: [file],
          types: ['Files'],
          getData: () => '',
        },
      });
      await new Promise((r) => setTimeout(r, 30));
    });

    const remove = container.querySelector('[data-composer-image-remove]') as HTMLButtonElement;
    expect(remove).not.toBeNull();
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(container.querySelector('[data-composer-images]')).toBeNull();
  });

  it('attaches an image from the in-card file button', async () => {
    const { container } = renderEmpty();
    const input = container.querySelector('[data-composer-attach-input]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(container.querySelector('[data-composer] [data-composer-attach]')).not.toBeNull();
    await act(async () => {
      fireEvent.change(input, { target: { files: [tinyPngFile()] } });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(container.querySelector('[data-composer-images]')).not.toBeNull();
  });
});
