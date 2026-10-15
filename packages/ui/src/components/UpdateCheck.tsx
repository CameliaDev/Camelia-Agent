/**
 * "检查更新" — two paths, one contract.
 *
 * Primary: the shell's own updater (`window/updater.ts` → `updater.rs`). A feed file
 * states the new version, a direct exe link and a sha256; the app downloads, verifies,
 * swaps the exe while it exits, and restarts itself — no installer wizard, no browser.
 *
 * Fallback: GitHub Releases + the NSIS installer (`window/updates.ts`).
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { readBootConfig } from '../transport/boot.js';
import { windowClose } from '../window/shell.js';
import { checkForUpdate, launchInstaller, type UpdateOffer } from '../window/updates.js';
import { applyUpdate, checkUpdate, inDesktopShell, type UpdateOffer as ShellOffer } from '../window/updater.js';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'error'; message: string }
  | { kind: 'shellOffer'; offer: ShellOffer }
  | { kind: 'releaseOffer'; offer: UpdateOffer }
  | { kind: 'applying'; offer: ShellOffer }
  | { kind: 'applyingFailed'; offer: ShellOffer; message: string }
  | { kind: 'downloading'; offer: UpdateOffer }
  | { kind: 'launched'; offer: UpdateOffer }
  | { kind: 'downloadError'; offer: UpdateOffer; message: string };

export function UpdateCheck({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function check(): Promise<void> {
    setPhase({ kind: 'checking' });
    const current = readBootConfig().version || '0.1.0';
    if (inDesktopShell()) {
      try {
        const offer = await checkUpdate();
        if (offer) {
          setPhase({ kind: 'shellOffer', offer });
          return;
        }
        setPhase({ kind: 'uptodate' });
        return;
      } catch {
        // Fall through to Releases API.
      }
    }
    try {
      const offer = await checkForUpdate(current);
      if (offer.updateAvailable) setPhase({ kind: 'releaseOffer', offer });
      else setPhase({ kind: 'uptodate' });
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function applyShell(offer: ShellOffer): Promise<void> {
    setPhase({ kind: 'applying', offer });
    try {
      await applyUpdate(offer);
      setPhase({ kind: 'applyingFailed', offer, message: 'swap did not start' });
    } catch (error) {
      setPhase({ kind: 'applyingFailed', offer, message: error instanceof Error ? error.message : String(error) });
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

  return (
    <section className="space-y-2" data-update-check>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('updates.check')}</h3>
      <button
        type="button"
        data-check-update
        disabled={phase.kind === 'checking' || phase.kind === 'applying' || phase.kind === 'downloading'}
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
      {phase.kind === 'uptodate' ? <p className="text-[12px] text-ink-2">{tr('updates.uptodate')}</p> : null}

      {phase.kind === 'shellOffer' || phase.kind === 'applying' || phase.kind === 'applyingFailed' ? (
        <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/8 p-3" data-update-shell-offer>
          <p className="text-[13px] font-medium text-ink">{tr('updates.available').replace('{version}', phase.offer.version)}</p>
          {phase.offer.notes ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-5 text-ink-2">{phase.offer.notes}</pre>
          ) : null}
          {phase.kind === 'applying' ? (
            <p className="text-[12px] text-ink-2" data-update-applying>
              {tr('updates.applying')}
            </p>
          ) : (
            <button
              type="button"
              data-update-apply
              className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-2"
              onClick={() => {
                void applyShell(phase.offer);
              }}
            >
              {tr('updates.apply')}
            </button>
          )}
          <p className="text-[11.5px] leading-5 text-ink-3">{tr('updates.restartHint')}</p>
          {phase.kind === 'applyingFailed' ? (
            <p className="text-[12px] text-bad" data-update-apply-error>
              {tr('updates.applyFailed')} — {phase.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase.kind === 'releaseOffer' ||
      phase.kind === 'downloading' ||
      phase.kind === 'launched' ||
      phase.kind === 'downloadError' ? (
        <div className="space-y-2 rounded-lg border border-line bg-base/40 p-3" data-update-offer>
          <p className="text-[13px] font-medium text-ink">{tr('updates.available').replace('{version}', phase.offer.latest)}</p>
          {phase.offer.notes ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-5 text-ink-2">{phase.offer.notes}</pre>
          ) : null}
          {phase.offer.asset ? (
            <button
              type="button"
              data-update-download
              disabled={phase.kind === 'downloading' || phase.kind === 'launched'}
              className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-2 disabled:opacity-40"
              onClick={() => {
                void install(phase.offer);
              }}
            >
              {phase.kind === 'downloading' ? tr('updates.downloading') : tr('updates.download')}
            </button>
          ) : (
            <p className="text-[12px] text-ink-2">{tr('updates.noAsset')}</p>
          )}
          <a className="block text-[12px] text-accent hover:underline" href={phase.offer.htmlUrl} target="_blank" rel="noreferrer">
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
