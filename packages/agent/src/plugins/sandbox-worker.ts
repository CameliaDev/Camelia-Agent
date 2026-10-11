/**
 * Sandbox worker — the plugin's side of the boundary.
 *
 * Runs in a worker thread with a deliberately small surface: it imports the
 * plugin, reads its `tools` export, and reports the declared descriptors. It
 * never receives the engine's `ToolEngine`, store or bus, so the plugin cannot
 * reach engine internals through this channel even by accident.
 *
 * @module
 */

import { parentPort, workerData } from 'node:worker_threads';

/** Descriptor shape mirrored from `@camelia/core` so the worker has no import of it. */
interface ToolDescriptor {
  name: string;
  description: string;
  schema: unknown;
  risk: string;
  reversible: boolean;
}

function describe(tool: unknown): ToolDescriptor | undefined {
  if (!tool || typeof tool !== 'object') return undefined;
  const candidate = tool as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || !candidate.name) return undefined;
  if (typeof candidate.description !== 'string' || !candidate.description) return undefined;
  if (!candidate.schema || typeof candidate.schema !== 'object') return undefined;
  if (typeof candidate.risk !== 'string') return undefined;
  if (typeof candidate.reversible !== 'boolean') return undefined;
  if (typeof candidate.run !== 'function') return undefined;
  return {
    name: candidate.name,
    description: candidate.description,
    schema: candidate.schema,
    risk: candidate.risk,
    reversible: candidate.reversible,
  };
}

async function main(): Promise<void> {
  const request = workerData as { entry: string } | undefined;
  const port = parentPort;
  if (!port) {
    // No parent channel means the worker was started without a request; there is
    // nowhere to report it, so exiting is the only correct action.
    return;
  }
  if (!request?.entry) {
    port.postMessage({ ok: false, error: 'sandbox received no entry to load' });
    return;
  }

  // The import is inside try/catch because a throwing plugin must produce a
  // response, not an unhandled rejection that kills the worker silently.
  let module: Record<string, unknown>;
  try {
    module = (await import(request.entry)) as Record<string, unknown>;
  } catch (error) {
    port.postMessage({ ok: false, error: `import failed: ${(error as Error).message}` });
    return;
  }

  const candidates: unknown[] = [];
  if (Array.isArray(module.tools)) candidates.push(...module.tools);
  const fallback = module.default;
  if (Array.isArray(fallback)) candidates.push(...fallback);
  else if (fallback && typeof fallback === 'object' && Array.isArray((fallback as { tools?: unknown }).tools)) {
    candidates.push(...((fallback as { tools: unknown[] }).tools));
  }

  const tools = candidates.map(describe).filter((t): t is ToolDescriptor => t !== undefined);
  port.postMessage({ ok: true, tools });
}

void main();