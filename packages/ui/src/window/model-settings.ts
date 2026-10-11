/**
 * Model choice lives in `~/.camelia/config.json`, which the desktop shell reads
 * when it starts the engine. The UI package does not touch the filesystem; the
 * Tauri commands do. Outside the desktop shell these calls are a no-op.
 * @module
 */

export interface ModelSettings {
  preferredProvider: string;
  model: string;
  gruntModel: string;
}

export interface KeyStatus {
  local: boolean;
  configured: boolean;
  hint: string;
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

export async function readModelSettings(): Promise<ModelSettings | null> {
  const pending = invoke<ModelSettings>('read_model_settings');
  if (!pending) return null;
  try {
    const value = await pending;
    if (!value || typeof value.preferredProvider !== 'string') return null;
    return {
      preferredProvider: value.preferredProvider,
      model: typeof value.model === 'string' ? value.model : '',
      gruntModel: typeof value.gruntModel === 'string' ? value.gruntModel : '',
    };
  } catch {
    return null;
  }
}

export async function writeModelSettings(settings: ModelSettings): Promise<string | null> {
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
