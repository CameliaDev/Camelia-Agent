/**
 * Connection-preset helpers (CC Switch–style cards persisted in config.json).
 * Pure functions — unit-tested without Tauri.
 * @module
 */

export interface PresetTemplate {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
}

export interface ProviderPresetRecord {
  id: string;
  label: string;
  kind?: string;
  baseUrl: string;
  models: string[];
  defaultModel?: string;
}

export interface ConnectionPresetCard {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  active: boolean;
  keyConfigured: boolean;
  keyHint?: string;
  builtin: boolean;
  /** True when this id exists in config.json providers[]. */
  persisted: boolean;
}

export const PRESET_TEMPLATES: PresetTemplate[] = [
  { id: 'aliyun', label: 'Aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['deepseek/deepseek-chat-v3.1:free', 'qwen/qwen3-coder:free'] },
  { id: 'opencode-zen', label: 'Zen', baseUrl: 'https://opencode.ai/zen/v1', models: ['claude-3-5-haiku', 'qwen2.5-coder-32b'] },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen2.5-coder:7b', 'llama3.2:3b'] },
  { id: 'custom', label: 'Custom', baseUrl: '', models: [] },
];

const BUILTIN_IDS = new Set(['ollama', 'openrouter', 'opencode-zen', 'aliyun']);

/** Slug for a new preset id: lowercase ascii, hyphenated, max 48. */
export function slugifyProviderId(name: string, fallback = 'custom'): string {
  const raw = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (raw.length > 0) return raw;
  const fb = fallback
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return fb || 'custom';
}

/** Pick a unique id given existing provider ids. */
export function uniqueProviderId(desired: string, existing: Iterable<string>, editingId?: string): string {
  const taken = new Set([...existing].map((id) => id.toLowerCase()));
  if (editingId) taken.delete(editingId.toLowerCase());
  let base = slugifyProviderId(desired);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`) && n < 1000) n += 1;
  return `${base}-${n}`;
}

export function suggestionFor(providerId: string): string {
  return PRESET_TEMPLATES.find((item) => item.id === providerId)?.models[0] ?? '';
}

export function templateFor(providerId: string): PresetTemplate {
  return PRESET_TEMPLATES.find((item) => item.id === providerId) ?? PRESET_TEMPLATES.find((item) => item.id === 'custom')!;
}

/**
 * Build the card list: config providers first, then missing builtins so Ollama
 * etc. stay visible even when not written into providers[].
 */
export function buildPresetCards(input: {
  providers: ProviderPresetRecord[];
  preferredProvider?: string;
  model?: string;
  keyStatus?: Record<string, { configured?: boolean; hint?: string; local?: boolean }>;
}): ConnectionPresetCard[] {
  const preferred = (input.preferredProvider || '').trim();
  const globalModel = (input.model || '').trim();
  const seen = new Set<string>();
  const cards: ConnectionPresetCard[] = [];

  const persistedIds = new Set(input.providers.map((p) => p.id));
  const push = (record: ProviderPresetRecord, builtin: boolean) => {
    if (!record.id || seen.has(record.id)) return;
    seen.add(record.id);
    const key = input.keyStatus?.[record.id];
    const model =
      (preferred === record.id && globalModel) ||
      record.defaultModel ||
      record.models[0] ||
      suggestionFor(record.id) ||
      '';
    cards.push({
      id: record.id,
      name: record.label || record.id,
      baseUrl: record.baseUrl || '',
      model,
      active: preferred === record.id,
      keyConfigured: record.id === 'ollama' || key?.local === true || key?.configured === true,
      keyHint: key?.hint,
      builtin: builtin || BUILTIN_IDS.has(record.id),
      persisted: persistedIds.has(record.id),
    });
  };

  for (const provider of input.providers) {
    push(
      {
        id: provider.id,
        label: provider.label,
        baseUrl: provider.baseUrl,
        models: provider.models ?? [],
        defaultModel: provider.defaultModel,
      },
      BUILTIN_IDS.has(provider.id),
    );
  }

  for (const template of PRESET_TEMPLATES) {
    if (template.id === 'custom') continue;
    if (seen.has(template.id)) continue;
    push(
      {
        id: template.id,
        label: template.label,
        baseUrl: template.baseUrl,
        models: template.models,
        defaultModel: template.models[0],
      },
      true,
    );
  }

  if (preferred && !seen.has(preferred)) {
    const template = templateFor(preferred);
    push(
      {
        id: preferred,
        label: template.label === 'Custom' ? preferred : template.label,
        baseUrl: template.baseUrl,
        models: template.models,
        defaultModel: globalModel || template.models[0],
      },
      BUILTIN_IDS.has(preferred),
    );
  }

  cards.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  return cards;
}
