/**
 * "检查更新" — fetch the latest GitHub Release and offer the NSIS installer.
 *
 * The check itself is pure (`checkForUpdate`). Launching the installer is a desktop
 * command; a browser preview can only open the release page.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { readBootConfig } from '../transport/boot.js';
import { windowClose } from '../window/shell.js';
import { checkForUpdate, launchInstaller, type UpdateOffer } from '../window/updates.js';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; offer: UpdateOffer }
  | { kind: 'error'; message: string }
  | { kind: 'downloading'; offer: UpdateOffer }
  | { kind: 'launched'; offer: UpdateOffer }
  | { kind: 'downloadError'; offer: UpdateOffer; message: string };

function offerOf(phase: Phase): UpdateOffer | null {
  if (
    phase.kind === 'result' ||
    phase.kind === 'downloading' ||
    phase.kind === 'launched' ||
    phase.kind === 'downloadError'
  ) {
    return phase.offer;
  }
  return null;
}

export function UpdateCheck({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function check(): Promise<void> {
    setPhase({ kind: 'checking' });
    const current = readBootConfig().version || '0.1.0';
    try {
      const offer = await checkForUpdate(current);
      setPhase({ kind: 'result', offer });
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function install(offer: UpdateOffer): Promise<void> {
    if (!offer.asset) return;
    setPhase({ kind: 'downloading', offer });
    const error = await launchInstaller(offer.asset.browserDownloadUrl);
    if (error) {
      setPhase({ kind: 'downloadError', offer, message: error });
      return;
    }
    setPhase({ kind: 'launched', offer });
  }

  const offer = offerOf(phase);

  return (
    <section className="space-y-2" data-update-check>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('updates.check')}</h3>
      <p className="text-[11.5px] leading-5 text-ink-3">{tr('updates.signing')}</p>
      <button
        type="button"
        data-check-update
        disabled={phase.kind === 'checking' || phase.kind === 'downloading'}
        className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-40"
        onClick={() => {
          void check();
        }}
      >
        {phase.kind === 'checking' ? tr('updates.checking') : tr('updates.check')}
      </button>
      {phase.kind === 'error' ? (
        <p className="text-[12px] text-bad" data-update-error>
          {tr('updates.failed')} — {phase.message}
        </p>
      ) : null}
      {offer && !offer.updateAvailable ? <p className="text-[12px] text-ink-2">{tr('updates.uptodate')}</p> : null}
      {offer && offer.updateAvailable ? (
        <div className="space-y-2 rounded-lg border border-line bg-base/40 p-3" data-update-offer>
          <p className="text-[13px] font-medium text-ink">{tr('updates.available').replace('{version}', offer.latest)}</p>
          {offer.notes ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-5 text-ink-2">{offer.notes}</pre>
          ) : null}
          {offer.asset ? (
            <button
              type="button"
              data-update-download
              disabled={phase.kind === 'downloading' || phase.kind === 'launched'}
              className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-2 disabled:opacity-40"
              onClick={() => {
                void install(offer);
              }}
            >
              {phase.kind === 'downloading' ? tr('updates.downloading') : tr('updates.download')}
            </button>
          ) : (
            <p className="text-[12px] text-ink-2">{tr('updates.noAsset')}</p>
          )}
          <a className="block text-[12px] text-accent hover:underline" href={offer.htmlUrl} target="_blank" rel="noreferrer">
            {tr('updates.openRelease')}
          </a>
        </div>
      ) : null}
      {phase.kind === 'downloadError' ? (
        <p className="text-[12px] text-ink-2" data-update-download-error>
          {phase.message === 'desktop shell required' ? tr('updates.desktopOnly') : phase.message}
        </p>
      ) : null}
      {phase.kind === 'launched' ? (
        <div className="space-y-2">
          <p className="text-[12px] leading-5 text-ink-2">{tr('updates.launched')}</p>
          <button
            type="button"
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:text-ink"
            onClick={() => {
              void windowClose();
            }}
          >
            {tr('updates.quit')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
