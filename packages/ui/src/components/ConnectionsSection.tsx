/**
 * Connection presets — CC Switch–style cards persisted to ~/.camelia/config.json.
 * @module
 */

import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { makeCommand } from '../state/store.js';
import { useUiStore } from '../state/UiProvider.js';
import {
  deleteProviderPreset,
  readKeyStatus,
  readModelSettings,
  testOpenAiCompatible,
  upsertProviderPreset,
  writeProviderKey,
  type KeyStatus,
} from '../window/model-settings.js';
import {
  PRESET_TEMPLATES,
  buildPresetCards,
  slugifyProviderId,
  suggestionFor,
  templateFor,
  uniqueProviderId,
  type ConnectionPresetCard,
} from '../window/provider-presets.js';
import { providerAvatarSrc } from '../lib/provider-avatars.js';

/** Infer persisted model caps so Term/composer pickers show vision + context without a second probe. */
function buildModelCapabilities(models: string[]): Record<string, { supportsVision?: boolean; contextWindow?: number }> {
  const out: Record<string, { supportsVision?: boolean; contextWindow?: number }> = {};
  for (const id of models) {
    const lower = id.toLowerCase();
    const vision = /vision|-vl|vl-|gpt-4o|gpt-4\.1|llava|qwen-vl|qwen2\.5-vl|qwen2-vl|gemini-|claude-3|claude-4|minicpm-v|internvl/.test(lower);
    const ctx = /qwen-long|gemini-1\.5-pro/.test(lower)
      ? 1_000_000
      : /claude/.test(lower)
        ? 200_000
        : /qwen/.test(lower)
          ? 131_072
          : 128_000;
    out[id] = { ...(vision ? { supportsVision: true } : {}), contextWindow: ctx };
  }
  return out;
}


type Tr = (key: Parameters<typeof t>[1]) => string;

export function ConnectionsSection({ tr }: { tr: Tr }): ReactNode {
  const status = useUiStore((s) => s.status);
  const query = useUiStore((s) => s.query);
  const connected = status === 'live' || status === 'finished';
  const [cards, setCards] = useState<ConnectionPresetCard[]>([]);
  const [keys, setKeys] = useState<Record<string, KeyStatus>>({});
  const [preferred, setPreferred] = useState('ollama');
  const [gruntModel, setGruntModel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [templateId, setTemplateId] = useState('aliyun');
  const [name, setName] = useState('Aliyun');
  const [presetId, setPresetId] = useState('aliyun');
  const [baseUrl, setBaseUrl] = useState(PRESET_TEMPLATES[0]!.baseUrl);
  const [model, setModel] = useState('qwen-plus');
  const [apiKey, setApiKey] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);

  async function reload(): Promise<void> {
    const settings = await readModelSettings();
    const keyStatus = await readKeyStatus();
    if (keyStatus) setKeys(keyStatus);
    const providerList = settings?.providers ?? [];
    const preferredProvider = settings?.preferredProvider || 'ollama';
    setPreferred(preferredProvider);
    setGruntModel(settings?.gruntModel ?? '');
    setCards(
      buildPresetCards({
        providers: providerList,
        preferredProvider,
        model: settings?.model,
        keyStatus: keyStatus ?? undefined,
      }),
    );
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reload();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Push the preset just written to disk onto the process that is already serving chat.
   * Offline, the file is enough: the next engine start reads it. A live engine used to
   * ignore the file until the desktop was quit.
   */
  async function pushLive(input: {
    providerId?: string;
    model?: string;
    gruntModel?: string;
  }): Promise<'applied' | 'offline' | 'failed'> {
    if (!connected) return 'offline';
    const payload: { providerId?: string; model?: string; gruntModel?: string } = {};
    if (input.providerId) payload.providerId = input.providerId;
    if (input.model) payload.model = input.model;
    if (input.gruntModel) payload.gruntModel = input.gruntModel;
    try {
      await query(makeCommand('apply_provider', payload));
      return 'applied';
    } catch {
      return 'failed';
    }
  }

  function savedNote(activate: boolean, live: 'applied' | 'offline' | 'failed'): string {
    if (live === 'failed') return tr('settings.presets.applyFailed');
    if (live === 'applied' && activate) return tr('settings.presets.applied');
    return activate ? tr('settings.presets.savedActive') : tr('settings.presets.saved');
  }

  const formOpen = creating || editingId !== null;
  const template = templateFor(templateId);
  const localProvider = presetId === 'ollama' || templateId === 'ollama';
  const key = keys[presetId] ?? keys[templateId];

  function openCreate(): void {
    const tpl = PRESET_TEMPLATES[0]!;
    setCreating(true);
    setEditingId(null);
    setTemplateId(tpl.id);
    setName(tpl.label);
    setPresetId(tpl.id);
    setBaseUrl(tpl.baseUrl);
    setModel(tpl.models[0] ?? '');
    setApiKey('');
    setNote('');
  }

  function openEdit(card: ConnectionPresetCard): void {
    const tpl = PRESET_TEMPLATES.find((item) => item.id === card.id) ?? templateFor('custom');
    setCreating(false);
    setEditingId(card.id);
    setTemplateId(tpl.id === card.id ? tpl.id : 'custom');
    setName(card.name);
    setPresetId(card.id);
    setBaseUrl(card.baseUrl);
    setModel(card.model);
    setApiKey('');
    setNote('');
  }

  function applyTemplate(id: string): void {
    const item = templateFor(id);
    setTemplateId(item.id);
    setName(item.label);
    setBaseUrl(item.baseUrl);
    setModel(item.models[0] ?? '');
    setApiKey('');
    if (!editingId) {
      const existing = cards.map((c) => c.id);
      if (item.id === 'custom') {
        setPresetId(uniqueProviderId(name || 'custom', existing));
      } else if (existing.includes(item.id)) {
        setPresetId(uniqueProviderId(item.label, existing));
      } else {
        setPresetId(item.id);
      }
    }
  }

  async function testConnection(): Promise<void> {
    setTesting(true);
    setNote('');
    try {
      const result = await testOpenAiCompatible({
        baseUrl: baseUrl.trim() || (localProvider ? 'http://127.0.0.1:11434/v1' : ''),
        apiKey: apiKey.trim() || undefined,
      });
      if (!result.ok) {
        setDiscoveredModels([]);
        setNote(tr('settings.presets.testFail') + ': ' + result.error + ' — ' + tr('settings.presets.manualModels'));
        return;
      }
      setDiscoveredModels(result.models);
      if (result.models.length > 0 && !model.trim()) {
        setModel(result.models[0]!);
      }
      setNote(tr('settings.presets.testOk') + ' · ' + result.models.length + ' ' + tr('settings.presets.modelsFound'));
    } finally {
      setTesting(false);
    }
  }

  async function persist(activate: boolean): Promise<void> {
    setBusy(true);
    setNote('');
    try {
      const existing = cards.map((c) => c.id);
      const id = editingId
        ? editingId
        : uniqueProviderId(presetId || slugifyProviderId(name, templateId), existing);
      if (!name.trim()) {
        setNote(tr('settings.presets.nameRequired'));
        return;
      }
      if (!model.trim()) {
        setNote(tr('settings.presets.modelRequired'));
        return;
      }
      if (!localProvider && !baseUrl.trim()) {
        setNote(tr('settings.presets.urlRequired'));
        return;
      }
      const typedKey = apiKey.trim();
      if (!localProvider && typedKey) {
        const keyError = await writeProviderKey(id, typedKey);
        if (keyError) {
          setNote(keyError);
          return;
        }
      }
      const models = Array.from(
        new Set([model.trim(), ...discoveredModels, ...template.models.filter((m) => m && m !== model.trim())]),
      );
      const error = await upsertProviderPreset({
        id,
        label: name.trim(),
        baseUrl: baseUrl.trim() || (localProvider ? 'http://127.0.0.1:11434/v1' : ''),
        models,
        modelCapabilities: buildModelCapabilities(models),
        defaultModel: model.trim(),
        activate,
        model: model.trim(),
        gruntModel: gruntModel.trim(),
      });
      if (error) {
        setNote(error);
        return;
      }
      const live = await pushLive(
        activate
          ? {
              providerId: id,
              model: model.trim(),
              ...(gruntModel.trim() ? { gruntModel: gruntModel.trim() } : {}),
            }
          : {},
      );
      setNote(savedNote(activate, live));
      setCreating(false);
      setEditingId(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function activateCard(card: ConnectionPresetCard): Promise<void> {
    setBusy(true);
    setNote('');
    try {
      const error = await upsertProviderPreset({
        id: card.id,
        label: card.name,
        baseUrl: card.baseUrl || templateFor(card.id).baseUrl,
        models: card.model ? [card.model] : templateFor(card.id).models,
        modelCapabilities: buildModelCapabilities(card.model ? [card.model] : templateFor(card.id).models),
        defaultModel: card.model || suggestionFor(card.id),
        activate: true,
        model: card.model || suggestionFor(card.id),
        gruntModel: gruntModel.trim(),
      });
      if (error) {
        setNote(error);
        return;
      }
      const chosen = card.model || suggestionFor(card.id);
      const live = await pushLive({
        providerId: card.id,
        model: chosen,
        ...(gruntModel.trim() ? { gruntModel: gruntModel.trim() } : {}),
      });
      setNote(savedNote(true, live));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function removeCard(card: ConnectionPresetCard): Promise<void> {
    if (card.active) {
      setNote(tr('settings.presets.cannotDeleteActive'));
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const error = await deleteProviderPreset(card.id);
      if (error) {
        setNote(error);
        return;
      }
      const live = await pushLive({});
      setNote(live === 'failed' ? tr('settings.presets.applyFailed') : tr('settings.presets.deleted'));
      if (editingId === card.id) setEditingId(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-ink-2">{connected ? tr('settings.connection.live') : tr('settings.connection.offline')}</p>
      <p className="text-[11.5px] leading-5 text-ink-3">{tr('settings.presets.hint')}</p>

      <div className="space-y-2" data-preset-list>
        {cards.map((card) => (
          <div
            key={card.id}
            data-preset-card={card.id}
            className={`rounded-lg border px-3 py-2.5 ${card.active ? 'border-accent/40 bg-accent/[0.06]' : 'border-line bg-base/40'}`}
          >
            <div className="flex items-start gap-2">
              <img
                src={providerAvatarSrc(card.id)}
                alt=""
                data-preset-avatar={card.id}
                className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-line"
                draggable={false}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[13px] font-medium text-ink">{card.name}</p>
                  {card.active ? (
                    <span className="rounded-full bg-accent/15 px-2 py-[1px] text-[10px] font-medium text-accent">
                      {tr('settings.presets.active')}
                    </span>
                  ) : null}
                  <span className="font-mono text-[10px] text-ink-3">{card.id}</span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-ink-3" title={card.baseUrl || '—'}>
                  {card.baseUrl || '—'}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-2">{card.model || '—'}</p>
              </div>
              <span
                className={`shrink-0 rounded-md border px-1.5 py-[1px] text-[10.5px] ${
                  card.keyConfigured ? 'border-ok/30 text-ok' : 'border-line text-ink-3'
                }`}
              >
                {card.keyConfigured ? tr('settings.apiKey.configured') : tr('settings.apiKey.missing')}
                {card.keyHint ? ` ${card.keyHint}` : ''}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
                onClick={() => openEdit(card)}
              >
                {tr('settings.presets.edit')}
              </button>
              <button
                type="button"
                disabled={busy || card.active}
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-40"
                onClick={() => {
                  void activateCard(card);
                }}
              >
                {tr('settings.presets.enable')}
              </button>
              <button
                type="button"
                disabled={busy || card.active || !card.persisted}
                title={!card.persisted ? tr('settings.presets.builtinLocked') : undefined}
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-bad/40 hover:text-bad disabled:opacity-40"
                onClick={() => {
                  void removeCard(card);
                }}
              >
                {tr('settings.presets.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {!formOpen ? (
        <button
          type="button"
          className="rounded-md border border-dashed border-line px-3 py-2 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
          onClick={() => openCreate()}
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
                disabled={Boolean(editingId)}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  templateId === item.id ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-ink-2 hover:border-accent/30'
                } disabled:opacity-50`}
                onClick={() => applyTemplate(item.id)}
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
              onChange={(event) => {
                setName(event.target.value);
                if (!editingId && templateId === 'custom') {
                  setPresetId(slugifyProviderId(event.target.value, 'custom'));
                }
              }}
            />
          </label>
          <label className="block text-[12px] text-ink-2">
            {tr('settings.presets.id')}
            <input
              aria-label={tr('settings.presets.id')}
              className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink disabled:opacity-60"
              value={presetId}
              disabled={Boolean(editingId)}
              onChange={(event) => setPresetId(slugifyProviderId(event.target.value, 'custom'))}
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
              list={discoveredModels.length ? "camelia-discovered-models" : "camelia-model-suggestions"}
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
          <p className="text-[10.5px] leading-5 text-ink-3">{tr('settings.modelHint.live')}</p>
          {discoveredModels.length ? (
            <datalist id="camelia-discovered-models">
              {discoveredModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy || testing || !baseUrl.trim() && !localProvider}
              data-preset-test
              className="rounded-md border border-info/40 px-2.5 py-1.5 text-[12px] text-info hover:bg-info/10 disabled:opacity-40"
              onClick={() => { void testConnection(); }}
            >
              {tr('settings.presets.test')}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-40"
              onClick={() => {
                void persist(true);
              }}
            >
              {tr('settings.presets.saveUse')}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-40"
              onClick={() => {
                void persist(false);
              }}
            >
              {tr('settings.presets.saveOnly')}
            </button>
            <button
              type="button"
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-3 hover:text-ink"
              onClick={() => {
                setCreating(false);
                setEditingId(null);
              }}
            >
              {tr('settings.close')}
            </button>
          </div>
          {note ? <p className="text-[12px] text-ink-2">{note}</p> : null}
        </div>
      )}

      {!formOpen && note ? <p className="text-[12px] text-ink-2">{note}</p> : null}
      {!formOpen ? <p className="font-mono text-[10.5px] text-ink-3">preferredProvider={preferred || '—'}</p> : null}
    </div>
  );
}
