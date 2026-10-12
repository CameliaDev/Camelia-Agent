/**
 * Disconnect / crash recovery strip.
 *
 * Shown only when the shell booted with a live engine URL and the transport
 * is offline. Fixture / demo mode stays quiet — offline there is intentional.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { openEngineLog, readEngineTrust } from '../window/engine.js';
import { relaunchDesktop } from '../window/model-settings.js';
import { isTauri } from '../window/shell.js';
import { Icon } from './primitives.js';

export function EngineBanner(): ReactNode {
  const status = useUiStore((s) => s.status);
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const trust = readEngineTrust();
  const [note, setNote] = useState('');

  if (status !== 'offline' || (!trust.expectsLiveEngine && !trust.spawnFailed)) return null;

  const desktop = isTauri();

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad"
    >
      <Icon name="alert" size={14} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{tr('connection.offlineBanner')}</p>
        <p className="text-[11px] text-ink-2">{tr('connection.offlineBanner.hint')}</p>
        {trust.engineUrl ? (
          <p className="mt-0.5 font-mono text-[10.5px] text-ink-3">{trust.engineUrl}</p>
        ) : null}
        {trust.engineSpawnError ? (
          <p className="mt-0.5 break-all font-mono text-[10.5px] text-ink-3">{trust.engineSpawnError}</p>
        ) : null}
        {note ? <p className="mt-0.5 break-all font-mono text-[10.5px] text-ink-3">{note}</p> : null}
      </div>
      <span className="text-[11px] text-ink-3">{tr('connection.waiting')}</span>
      {desktop ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded-md border border-bad/40 bg-base px-2 py-1 text-[11px] text-ink hover:border-accent/40 hover:text-accent"
            onClick={() => {
              void openEngineLog().then((result) => setNote(result.error ?? result.path ?? ''));
            }}
          >
            {tr('connection.openLog')}
          </button>
          <button
            type="button"
            className="rounded-md border border-bad/40 bg-base px-2 py-1 text-[11px] text-ink hover:border-accent/40 hover:text-accent"
            onClick={() => {
              void relaunchDesktop().then((error) => {
                if (error) setNote(error);
              });
            }}
          >
            {tr('connection.restart')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
