/**
 * Settings page — multi-section shell opened from the bottom-left account entry.
 *
 * Sections (wireframe v2): connection presets, language & appearance, engine & logs, about.
 * Connection presets use a CC Switch–style card list; full CRUD against ~/.camelia is TODO.
 * @module
 */

import { useEffect, useState, type ReactNode } from 'react';

import { makeCommand } from '../state/store.js';
import { useUiStore } from '../state/UiProvider.js';
import { type LanguagePref, type MotionPref, type TopBarMode } from '../state/local-prefs.js';
import { t } from '../i18n/strings.js';
import { THEME_PRESETS, type ThemeId } from '../theme/presets.js';
import { readKeyStatus, readModelSettings, relaunchDesktop, writeModelSettings, writeProviderKey, type KeyStatus } from '../window/model-settings.js';
import { openEngineLog, readEngineTrust } from '../window/engine.js';
import { isTauri } from '../window/shell.js';
import { Avatar, Icon } from './primitives.js';

type SettingsSection = 'connections' | 'appearance' | 'engine' | 'about';

const MONO_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'JetBrains Mono' },
  { value: "'Cascadia Mono', Consolas, monospace", label: 'Cascadia Mono' },
  { value: 'Consolas, monospace', label: 'Consolas' },
];

const NO_REJECTIONS: Array<{ token: string; reason: string }> = [];

/** Built-in templates for the connection-preset form (CC Switch style). */
const PRESET_TEMPLATES: Array<{ id: string; label: string; baseUrl: string; models: string[] }> = [
  { id: 'aliyun', label: 'Aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: [] },
  { id: 'opencode-zen', label: 'Zen', baseUrl: '', models: [] },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen2.5-coder:7b'] },
  { id: 'custom', label: 'Custom', baseUrl: '', models: [] },
];

interface ConnectionPresetCard {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  model: string;
  active: boolean;
  keyConfigured: boolean;
  keyHint?: string;
}

export function SettingsDrawer(): ReactNode {
  const open = useUiStore((s) => s.settingsOpen);
  const prefs = useUiStore((s) => s.localPrefs);
  const rejected = useUiStore((s) => s.activeTheme?.rejected) ?? NO_REJECTIONS;
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const tr = (key: Parameters<typeof t>[1]) => t(prefs.language, key);
  const [section, setSection] = useState<SettingsSection>('connections');

  useEffect(() => {
    if (open) setSection('connections');
  }, [open]);

  if (!open) return null;

  const nav: Array<{ id: SettingsSection; label: string; icon: string }> = [
    { id: 'connections', label: tr('settings.section.connections'), icon: 'layers' },
    { id: 'appearance', label: tr('settings.section.appearance'), icon: 'theme' },
    { id: 'engine', label: tr('settings.section.engine'), icon: 'terminal' },
    { id: 'about', label: tr('settings.section.about'), icon: 'info' },
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-stretch justify-center bg-base/55 p-4 sm:p-6" data-settings-page>
      <button type="button" aria-label={tr('settings.close')} className="absolute inset-0 cursor-default" onClick={() => setSettingsOpen(false)} />
      <div className="relative flex h-full w-full max-w-[920px] overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl">
        <nav className="flex w-[200px] shrink-0 flex-col border-r border-line bg-base/40" aria-label={tr('settings.title')}>
          <div className="flex items-center gap-2 border-b border-line px-3 py-3">
            <Avatar kind="agent" size={28} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{tr('settings.title')}</p>
              <p className="truncate text-[10.5px] text-ink-3">{tr('brand.placeholder')}</p>
            </div>
          </div>
          <ul className="flex-1 space-y-0.5 p-2">
            {nav.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-settings-nav={item.id}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] ${
                    section === item.id ? 'bg-accent/10 font-medium text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink'
                  }`}
                  onClick={() => setSection(item.id)}
                >
                  <Icon name={item.icon} size={14} />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">{nav.find((n) => n.id === section)?.label}</h2>
            <button
              type="button"
              aria-label={tr('settings.close')}
              className="grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
              onClick={() => setSettingsOpen(false)}
            >
              <Icon name="x" size={14} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {rejected.length > 0 && section === 'appearance' ? (
              <div className="mb-4 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                <p className="font-medium">{rejected.length} {tr('settings.tokenRejected')}</p>
                <ul className="mt-1 space-y-1">
                  {rejected.map((item) => (
                    <li key={`${item.token}-${item.reason}`}>
                      <span className="font-mono">{item.token}</span> — {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {section === 'connections' ? <ConnectionsSection tr={tr} /> : null}
            {section === 'appearance' ? <AppearanceSection tr={tr} /> : null}
            {section === 'engine' ? <EngineSection tr={tr} /> : null}
            {section === 'about' ? <AboutSection tr={tr} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectionsSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const status = useUiStore((s) => s.status);
  const connected = status === 'live' || status === 'finished';
  const [cards, setCards] = useState<ConnectionPresetCard[]>([]);
  const [keys, setKeys] = useState<Record<string, KeyStatus>>({});
  const [editing, setEditing] = useState(false);
  const [templateId, setTemplateId] = useState('aliyun');
  const [name, setName] = useState('Aliyun');
  const [baseUrl, setBaseUrl] = useState(PRESET_TEMPLATES[0]!.baseUrl);
  const [model, setModel] = useState('qwen-plus');
  const [gruntModel, setGruntModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [todoNote] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await readModelSettings();
      const keyStatus = await readKeyStatus();
      if (cancelled) return;
      if (keyStatus) setKeys(keyStatus);
      const provider = settings?.preferredProvider || 'aliyun';
      const modelName = settings?.model || suggestionFor(provider);
      const key = keyStatus?.[provider];
      const template = PRESET_TEMPLATES.find((item) => item.id === provider) ?? PRESET_TEMPLATES[0]!;
      setCards([
        {
          id: 'active',
          name: template.label,
          providerId: provider,
          baseUrl: template.baseUrl,
          model: modelName,
          active: true,
          keyConfigured: key?.configured === true || provider === 'ollama',
          keyHint: key?.hint,
        },
      ]);
      setTemplateId(provider);
      setName(template.label);
      setBaseUrl(template.baseUrl);
      setModel(modelName);
      setGruntModel(settings?.gruntModel ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const template = PRESET_TEMPLATES.find((item) => item.id === templateId) ?? PRESET_TEMPLATES[0]!;
  const localProvider = templateId === 'ollama';
  const key = keys[templateId];

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-ink-2">{connected ? tr('settings.connection.live') : tr('settings.connection.offline')}</p>
      {todoNote ? (
        <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[11.5px] leading-5 text-warn">
          {tr('settings.presets.todo')}
        </p>
      ) : null}

      <div className="space-y-2" data-preset-list>
        {cards.map((card) => (
          <div
            key={card.id}
            data-preset-card={card.providerId}
            className={`rounded-lg border px-3 py-2.5 ${card.active ? 'border-accent/40 bg-accent/[0.06]' : 'border-line bg-base/40'}`}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[13px] font-medium text-ink">{card.name}</p>
                  {card.active ? (
                    <span className="rounded-full bg-accent/15 px-2 py-[1px] text-[10px] font-medium text-accent">{tr('settings.presets.active')}</span>
                  ) : null}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-ink-3" title={card.baseUrl || '—'}>
                  {card.baseUrl || '—'}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-2">{card.model || '—'}</p>
              </div>
              <span className={`shrink-0 rounded-md border px-1.5 py-[1px] text-[10.5px] ${card.keyConfigured ? 'border-ok/30 text-ok' : 'border-line text-ink-3'}`}>
                {card.keyConfigured ? tr('settings.apiKey.configured') : tr('settings.apiKey.missing')}
                {card.keyHint ? ` ${card.keyHint}` : ''}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
                onClick={() => {
                  setEditing(true);
                  setTemplateId(card.providerId);
                  setName(card.name);
                  setBaseUrl(card.baseUrl);
                  setModel(card.model);
                }}
              >
                {tr('settings.presets.edit')}
              </button>
              <button
                type="button"
                disabled
                title={tr('settings.presets.todo')}
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-3 opacity-50"
              >
                {tr('settings.presets.enable')}
              </button>
              <button
                type="button"
                disabled
                title={tr('settings.presets.todo')}
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-3 opacity-50"
              >
                {tr('settings.presets.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {!editing ? (
        <button
          type="button"
          className="rounded-md border border-dashed border-line px-3 py-2 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
          onClick={() => setEditing(true)}
        >
          + {tr('settings.presets.add')}
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-line bg-base/50 p-3" data-preset-form>
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.presets.templates')}</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_TEMPLATES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  templateId === item.id ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-ink-2 hover:border-accent/30'
                }`}
                onClick={() => {
                  setTemplateId(item.id);
                  setName(item.label);
                  setBaseUrl(item.baseUrl);
                  setModel(item.models[0] ?? '');
                  setApiKey('');
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="block text-[12px] text-ink-2">
            {tr('settings.presets.name')}
            <input
              aria-label={tr('settings.presets.name')}
              className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-[12px] text-ink"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block text-[12px] text-ink-2">
            {tr('settings.presets.baseUrl')}
            <input
              aria-label={tr('settings.presets.baseUrl')}
              className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
          {localProvider ? (
            <p className="text-[12px] text-ink-2">{tr('settings.apiKey.local')}</p>
          ) : (
            <label className="block text-[12px] text-ink-2">
              {tr('settings.apiKey')}
              <span className="ml-2 font-mono text-[10.5px] text-ink-3">
                {key?.configured ? `${tr('settings.apiKey.configured')} ${key.hint}` : tr('settings.apiKey.missing')}
              </span>
              <input
                aria-label={tr('settings.apiKey')}
                type="password"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink"
                value={apiKey}
                placeholder={key?.configured ? tr('settings.apiKey.placeholder') : 'sk-…'}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          )}
          <label className="block text-[12px] text-ink-2">
            {tr('settings.modelName')}
            <input
              aria-label={tr('settings.modelName')}
              list="camelia-model-suggestions"
              className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
            <datalist id="camelia-model-suggestions">
              {template.models.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
          <label className="block text-[12px] text-ink-2">
            {tr('settings.gruntModel')}
            <input
              aria-label={tr('settings.gruntModel')}
              className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink"
              value={gruntModel}
              placeholder="qwen2.5-coder:7b"
              onChange={(event) => setGruntModel(event.target.value)}
            />
          </label>
          <p className="text-[10.5px] leading-5 text-ink-3">
            {connected ? tr('settings.modelHint.live') : tr('settings.modelHint.offline')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy || model.trim().length === 0}
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-40"
              onClick={() => {
                setBusy(true);
                setNote('');
                void (async () => {
                  const typedKey = apiKey.trim();
                  if (!localProvider && typedKey) {
                    const keyError = await writeProviderKey(templateId, typedKey);
                    if (keyError) return keyError;
                  }
                  // TODO(presets): persist named cards + baseUrl into ~/.camelia/config.json providers[].
                  return writeModelSettings({
                    preferredProvider: templateId,
                    model: model.trim(),
                    gruntModel: gruntModel.trim(),
                  });
                })().then(async (error) => {
                  if (error) {
                    setNote(error);
                    setBusy(false);
                    return;
                  }
                  setNote(tr('settings.modelSaved'));
                  const relaunchError = await relaunchDesktop();
                  if (relaunchError) {
                    setNote(relaunchError);
                    setBusy(false);
                  }
                });
              }}
            >
              {tr('settings.modelSave')}
            </button>
            <button
              type="button"
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-3 hover:text-ink"
              onClick={() => setEditing(false)}
            >
              {tr('settings.close')}
            </button>
          </div>
          {note ? <p className="text-[12px] text-ink-2">{note}</p> : null}
        </div>
      )}
    </div>
  );
}

function AppearanceSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const prefs = useUiStore((s) => s.localPrefs);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const dispatch = useUiStore((s) => s.dispatch);
  const restoreDefaultLayout = useUiStore((s) => s.restoreDefaultLayout);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.appearance')}</h3>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.language')}
          <select
            aria-label={tr('settings.language')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.language}
            onChange={(event) => setLocalPrefs({ language: event.target.value as LanguagePref })}
          >
            <option value="en">{tr('lang.en')}</option>
            <option value="zh">{tr('lang.zh')}</option>
          </select>
        </label>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.theme')}
          <select
            aria-label={tr('settings.theme')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.themeId}
            onChange={(event) => setLocalPrefs({ themeId: event.target.value as ThemeId })}
          >
            {THEME_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.font')}
          <select
            aria-label={tr('settings.font')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.fontMono}
            onChange={(event) => setLocalPrefs({ fontMono: event.target.value })}
          >
            {MONO_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.topBar')}
          <select
            aria-label={tr('settings.topBar')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.topBar}
            onChange={(event) => setLocalPrefs({ topBar: event.target.value as TopBarMode })}
          >
            <option value="auto">{tr('settings.topBar.auto')}</option>
            <option value="pinned">{tr('settings.topBar.pinned')}</option>
            <option value="hidden">{tr('settings.topBar.hidden')}</option>
          </select>
        </label>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.motion')}
          <select
            aria-label={tr('settings.motion')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.motion}
            onChange={(event) => setLocalPrefs({ motion: event.target.value as MotionPref })}
          >
            <option value="system">{tr('settings.motion.system')}</option>
            <option value="reduce">{tr('settings.motion.reduce')}</option>
          </select>
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.plans')}</h3>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.planApproval')}
          <select
            aria-label={tr('settings.planApproval')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.planApproval}
            onChange={(event) => {
              const mode = event.target.value === 'auto' ? 'auto' : 'always';
              setLocalPrefs({ planApproval: mode });
              dispatch(makeCommand('set_plan_approval', { mode }));
            }}
          >
            <option value="always">{tr('settings.planApproval.always')}</option>
            <option value="auto">{tr('settings.planApproval.auto')}</option>
          </select>
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.layout')}</h3>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.leftWidth')} ({prefs.leftWidth}px)
          <input
            aria-label={tr('settings.leftWidth')}
            type="range"
            min={200}
            max={420}
            value={prefs.leftWidth}
            className="mt-1 w-full"
            onChange={(event) => setLocalPrefs({ leftWidth: Number(event.target.value) })}
          />
        </label>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.rightWidth')} ({prefs.rightWidth}px)
          <input
            aria-label={tr('settings.rightWidth')}
            type="range"
            min={280}
            max={560}
            value={prefs.rightWidth}
            className="mt-1 w-full"
            onChange={(event) => setLocalPrefs({ rightWidth: Number(event.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input type="checkbox" checked={prefs.leftCollapsed} onChange={(event) => setLocalPrefs({ leftCollapsed: event.target.checked })} />
          {tr('settings.collapseSessions')}
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input type="checkbox" checked={prefs.rightCollapsed} onChange={(event) => setLocalPrefs({ rightCollapsed: event.target.checked })} />
          {tr('settings.collapseRunRail')}
        </label>
        <button
          type="button"
          className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
          onClick={() => restoreDefaultLayout()}
        >
          {tr('settings.restoreLayout')}
        </button>
        <p className="text-[10.5px] text-ink-3">{tr('settings.layoutDefaults')}</p>
      </section>
    </div>
  );
}

function EngineSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const trust = readEngineTrust();
  const desktop = isTauri();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

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
    </section>
  );
}

function AboutSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
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
}

function suggestionFor(provider: string): string {
  return PRESET_TEMPLATES.find((item) => item.id === provider)?.models[0] ?? '';
}
