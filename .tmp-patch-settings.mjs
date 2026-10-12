import fs from 'node:fs';

function edit(path, fn) {
  const raw = fs.readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  s = fn(s);
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}

edit('packages/ui/src/components/SettingsDrawer.tsx', (s) => {
  if (!s.includes('readEngineLog')) {
    s = s.replace(
      "import { openEngineLog, readEngineTrust } from '../window/engine.js';",
      "import { openEngineLog, readEngineLog, readEngineTrust } from '../window/engine.js';",
    );
  }

  // Replace EngineSection with log viewer
  if (!s.includes('data-engine-log')) {
    const start = s.indexOf('function EngineSection');
    const about = s.indexOf('function AboutSection');
    if (start < 0 || about < 0) throw new Error('engine/about anchors');
    const engine = `function EngineSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const trust = readEngineTrust();
  const desktop = isTauri();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [logText, setLogText] = useState<string>('');
  const [logError, setLogError] = useState<string>('');

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void readEngineLog(200).then((result) => {
      if (cancelled) return;
      if (result.error) setLogError(result.error);
      else setLogText(result.text ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.diagnostics')}</h3>
      {trust.expectsLiveEngine ? (
        <dl className="space-y-1.5 text-[12px] text-ink-2">
          <div>
            <dt className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{tr('connection.engineUrl')}</dt>
            <dd className="break-all font-mono text-[11px]">{trust.engineUrl}</dd>
          </div>
          <div>
            <dt className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{tr('connection.session')}</dt>
            <dd className="font-mono text-[11px]">{trust.sessionId || '—'}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-[12px] text-ink-2">
          {tr('connection.fixture')}
          {trust.scene ? <span className="mt-1 block font-mono text-[11px] text-ink-3">{trust.scene}</span> : null}
        </p>
      )}
      {desktop ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
            onClick={() => {
              void openEngineLog().then((result) => setNote(result.error ?? result.path ?? ''));
            }}
          >
            {tr('settings.openEngineLog')}
          </button>
          <button
            type="button"
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
            onClick={() => {
              void readEngineLog(200).then((result) => {
                if (result.error) setLogError(result.error);
                else {
                  setLogError('');
                  setLogText(result.text ?? '');
                }
              });
            }}
          >
            {tr('settings.refreshEngineLog')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              void relaunchDesktop().then((error) => {
                if (error) {
                  setNote(error);
                  setBusy(false);
                }
              });
            }}
          >
            {tr('settings.restartDesktop')}
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-3">{tr('settings.engine.browserHint')}</p>
      )}
      {note ? <p className="break-all font-mono text-[11px] text-ink-3">{note}</p> : null}
      <div className="space-y-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.engineLog')}</h4>
        {logError ? <p className="text-[12px] text-ink-3">{logError}</p> : null}
        <pre
          data-engine-log
          className="max-h-64 overflow-auto rounded-md border border-line bg-base/60 p-2 font-mono text-[10.5px] leading-4 text-ink-2"
        >
          {logText || tr('settings.engineLog.empty')}
        </pre>
      </div>
    </section>
  );
}

`;
    s = s.slice(0, start) + engine + s.slice(about);
  }

  // About with version + build stamp
  if (!s.includes('data-about-version')) {
    const aboutOld = `function AboutSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.about')}</h3>
      <p className="text-[12px] text-ink-2">Camelia 0.1.0</p>
      <p className="text-[12px] text-ink-3">{tr('brand.placeholder')}</p>
      <p className="font-mono text-[12px] text-ink-2">~/.camelia</p>
      <p className="text-[12px] text-ink-3">{tr('settings.about.preface')}</p>
      <p className="text-[12px] text-ink-3">{tr('settings.about.license')}</p>
    </section>
  );
}`;
    const aboutNew = `function AboutSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const boot = typeof window !== 'undefined' ? (window as unknown as { __CAMELIA_BOOT__?: { commit?: string; version?: string } }).__CAMELIA_BOOT__ : undefined;
  const version = boot?.version || '0.1.0';
  const commit = boot?.commit || 'f5592c3+';
  return (
    <section className="space-y-2" data-about-version>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.about')}</h3>
      <p className="text-[12px] text-ink-2">Camelia {version}</p>
      <p className="font-mono text-[11px] text-ink-3">{tr('settings.about.commit')}: {commit}</p>
      <p className="text-[12px] text-ink-3">{tr('brand.placeholder')}</p>
      <p className="font-mono text-[12px] text-ink-2">~/.camelia</p>
      <p className="text-[12px] text-ink-3">{tr('settings.about.preface')}</p>
      <p className="text-[12px] text-ink-3">{tr('settings.about.license')}</p>
    </section>
  );
}`;
    if (!s.includes(aboutOld)) throw new Error('about needle');
    s = s.replace(aboutOld, aboutNew);
  }
  return s;
});
console.log('Settings ok');
