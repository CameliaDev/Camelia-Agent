/**
 * Model / connection-preset settings live in `~/.camelia/config.json` and
 * `keys.json`. The UI never touches the filesystem; Tauri commands do.
 * Outside the desktop shell these calls are a no-op / soft error.
 * @module
 */

import type { ProviderPresetRecord } from './provider-presets.js';

export interface ModelSettings {
  preferredProvider: string;
  model: string;
  gruntModel: string;
  providers: ProviderPresetRecord[];
}

export interface KeyStatus {
  local: boolean;
  configured: boolean;
  hint: string;
}

export interface UpsertProviderPresetInput {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  defaultModel?: string;
  /** When true, also set preferredProvider + model/gruntModel. */
  activate?: boolean;
  model?: string;
  gruntModel?: string;
}

interface TauriCore {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> | null {
  const host = globalThis as unknown as { __TAURI__?: { core?: TauriCore } };
  const fn = host.__TAURI__?.core?.invoke;
  if (!fn) return null;
  return fn<T>(cmd, args);
}

function asProviders(raw: unknown): ProviderPresetRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: ProviderPresetRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) continue;
    const models = Array.isArray(row.models)
      ? row.models.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim())
      : [];
    out.push({
      id,
      label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : id,
      kind: typeof row.kind === 'string' ? row.kind : undefined,
      baseUrl: typeof row.baseUrl === 'string' ? row.baseUrl.trim() : '',
      models,
      defaultModel: typeof row.defaultModel === 'string' ? row.defaultModel.trim() : undefined,
    });
  }
  return out;
}

export async function readModelSettings(): Promise<ModelSettings | null> {
  const pending = invoke<Record<string, unknown>>('read_model_settings');
  if (!pending) return null;
  try {
    const value = await pending;
    if (!value || typeof value.preferredProvider !== 'string') return null;
    return {
      preferredProvider: value.preferredProvider,
      model: typeof value.model === 'string' ? value.model : '',
      gruntModel: typeof value.gruntModel === 'string' ? value.gruntModel : '',
      providers: asProviders(value.providers),
    };
  } catch {
    return null;
  }
}

export async function writeModelSettings(settings: {
  preferredProvider: string;
  model: string;
  gruntModel: string;
}): Promise<string | null> {
  const pending = invoke<void>('write_model_settings', {
    preferredProvider: settings.preferredProvider,
    model: settings.model,
    gruntModel: settings.gruntModel,
  });
  if (!pending) return 'desktop shell required';
  try {
    await pending;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function upsertProviderPreset(input: UpsertProviderPresetInput): Promise<string | null> {
  const pending = invoke<void>('upsert_provider_preset', {
    id: input.id,
    label: input.label,
    baseUrl: input.baseUrl,
    models: input.models,
    defaultModel: input.defaultModel ?? input.model ?? '',
    activate: input.activate === true,
    model: input.model ?? '',
    gruntModel: input.gruntModel ?? '',
  });
  if (!pending) return 'desktop shell required';
  try {
    await pending;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function deleteProviderPreset(id: string): Promise<string | null> {
  const pending = invoke<void>('delete_provider_preset', { id });
  if (!pending) return 'desktop shell required';
  try {
    await pending;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function readKeyStatus(): Promise<Record<string, KeyStatus> | null> {
  const pending = invoke<Record<string, KeyStatus>>('read_key_status');
  if (!pending) return null;
  try {
    const value = await pending;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export async function writeProviderKey(provider: string, apiKey: string): Promise<string | null> {
  const pending = invoke<void>('write_provider_key', { provider, apiKey });
  if (!pending) return 'desktop shell required';
  try {
    await pending;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function relaunchDesktop(): Promise<string | null> {
  const pending = invoke<void>('relaunch_app');
  if (!pending) return 'desktop shell required';
  try {
    await pending;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
