/**
 * Model / connection-preset settings live in `~/.camelia/config.json` and
 * `keys.json`. The UI never touches the filesystem; Tauri commands do.
 * Outside the desktop shell these calls are a no-op / soft error.
 * @module
 */

import type { ProviderPresetRecord } from './provider-presets.js';

/** Mirrors `HarnessConfig['planApproval']` and `CameliaConfig['planApproval']`. */
export type PlanApprovalMode = 'always' | 'auto';

export interface ModelSettings {
  preferredProvider: string;
  model: string;
  gruntModel: string;
  /**
   * The persisted plan-approval policy.
   *
   * `null` means this install has never chosen one. That is deliberately distinct from
   * `'always'` (the engine's fallback): boot reconciliation must be able to leave an
   * existing window-local preference alone rather than overwrite it with a default.
   */
  planApproval: PlanApprovalMode | null;
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
  /** Per-model caps persisted into config.json providers[].modelCapabilities. */
  modelCapabilities?: Record<string, { contextWindow?: number; supportsVision?: boolean; supportsTools?: boolean; supportsJson?: boolean; label?: string }>;
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
    const modelCapabilities =
      row.modelCapabilities && typeof row.modelCapabilities === 'object' && !Array.isArray(row.modelCapabilities)
        ? (row.modelCapabilities as ProviderPresetRecord['modelCapabilities'])
        : undefined;
    out.push({
      id,
      label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : id,
      kind: typeof row.kind === 'string' ? row.kind : undefined,
      baseUrl: typeof row.baseUrl === 'string' ? row.baseUrl.trim() : '',
      models,
      defaultModel: typeof row.defaultModel === 'string' ? row.defaultModel.trim() : undefined,
      ...(modelCapabilities ? { modelCapabilities } : {}),
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
      planApproval:
        value.planApproval === 'auto' ? 'auto' : value.planApproval === 'always' ? 'always' : null,
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

/**
 * Persist the plan-approval policy to `~/.camelia/config.json`.
 *
 * Paired with a `set_plan_approval` command: the command changes the *running* engine,
 * this makes the choice survive the next launch. Without it the desktop's
 * spawn-a-fresh-engine-per-launch model silently reverted to `always`.
 */
export async function writePlanApproval(mode: PlanApprovalMode): Promise<string | null> {
  const pending = invoke<void>('write_plan_approval', { mode });
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
    modelCapabilities: input.modelCapabilities ?? null,
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

/**
 * Probe an OpenAI-compatible endpoint: GET {base}/models (or /v1/models) with Bearer.
 * Returns discovered model ids, or an error so the UI can fall back to manual entry.
 */
export async function testOpenAiCompatible(input: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const raw = input.baseUrl.trim().replace(/\/$/, '');
  if (!raw) return { ok: false, error: 'empty-url' };
  const candidates = raw.endsWith('/v1')
    ? [`${raw}/models`]
    : [`${raw}/v1/models`, `${raw}/models`];
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = input.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  let lastError = 'unreachable';
  for (const url of candidates) {
    try {
      const res = await fetchImpl(url, { headers });
      if (!res.ok) {
        lastError = `http-${res.status}`;
        continue;
      }
      const body = (await res.json()) as { data?: unknown };
      const models: string[] = [];
      if (Array.isArray(body.data)) {
        for (const row of body.data) {
          if (row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string') {
            const id = (row as { id: string }).id.trim();
            if (id) models.push(id);
          }
        }
      }
      return { ok: true, models };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastError };
}
