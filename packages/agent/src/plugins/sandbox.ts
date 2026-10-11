/**
 * Plugin sandbox — load plugin code in a worker thread, not the main process.
 *
 * ## Why
 *
 * Without this, a plugin is not sandboxed at all: `PluginLoader`'s permission
 * restrictions constrain the `ToolContext` a plugin *chooses to use*, but
 * nothing stops a plugin from reaching for `process`, `require('fs')` or a
 * `while (true)`. Declared permissions are therefore only honest for plugins we
 * trust, and whitepaper §8.1 asks for a worker boundary precisely because
 * third-party code is not automatically trusted.
 *
 * A worker gives three things an in-process load cannot:
 *
 * 1. **A crash is survivable.** `process.exit()` in a plugin kills the worker,
 *    not the engine. The loader records the failure and carries on.
 * 2. **A hang is survivable.** Plugins get a deadline; exceeding it terminates
 *    the worker rather than blocking a task forever.
 * 3. **The plugin cannot see our internals.** It gets a narrow message
 *    protocol, not the live `ToolEngine` or `SessionStore` objects.
 *
 * ## What it does not claim
 *
 * A worker is **not a security sandbox**. It shares the process's memory
 * space's file descriptors and its Node permissions; a determined plugin can
 * still reach the filesystem. What it does buy is *blast-radius containment*
 * against the two failure modes that actually occur in practice — a crash and a
 * hang — plus the removal of accidental reach-through to engine internals.
 * Permission enforcement remains `PluginLoader`'s job; this narrows what a
 * misbehaving plugin can do to the *engine*, not to the *machine*.
 *
 * @module
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { PluginPermission, ToolDescriptor } from '@camelia/core';

/** Message the host sends into the worker. */
export interface SandboxRequest {
  /** Entry module to import, as a file URL. */
  entry: string;
  /** Module specifiers the plugin is allowed to import. */
  permissions: PluginPermission[];
  /** Milliseconds before the worker is terminated. */
  timeoutMs: number;
}

/** Message the worker sends back. */
export type SandboxResponse =
  | { ok: true; tools: ToolDescriptor[]; stdout: string[] }
  | { ok: false; error: string };

/** Default deadline. A plugin that cannot load in this long is broken or hostile. */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 5_000;

/**
 * Locate the worker module.
 *
 * The worker is written in TypeScript, so under the test runner the sibling
 * file is `.ts` — which Node's worker loader refuses. Pointing at it blindly
 * produces `Cannot find module` at spawn time, which reads like a sandbox bug
 * rather than a resolution one. Prefer the compiled `.js` next to this module
 * and fall back to the source file when only that exists.
 */
function workerUrl(): URL {
  const here = new URL('./sandbox-worker.js', import.meta.url);
  if (fs.existsSync(fileURLToPath(here))) return here;
  return new URL('./sandbox-worker.ts', import.meta.url);
}

/**
 * Load a tool plugin's descriptors in a worker thread.
 *
 * Resolves with the declared tools on success, or an error string on failure —
 * never rejects, because the caller's response to a hostile plugin is to record
 * a rejection and continue, and an exception would force that decision on it.
 */
export function loadToolsInWorker(request: SandboxRequest): Promise<SandboxResponse> {
  const timeoutMs = Math.max(250, request.timeoutMs);

  return new Promise<SandboxResponse>((resolve) => {
    let settled = false;
    let worker: Worker | undefined;

    const finish = (response: SandboxResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker?.terminate();
      resolve(response);
    };

    // The deadline is enforced from the host side, not the worker. A worker that
    // has already entered a synchronous loop cannot be asked to stop politely —
    // `terminate()` is the only thing that works, which is the point.
    const timer = setTimeout(() => {
      finish({ ok: false, error: `plugin load timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    try {
// The request travels as `workerData` rather than a message, so it is
    // available the moment the worker's first line runs. Sending it via
    // `postMessage` races the module's own initialisation, and a worker that
    // reads before the message lands sees nothing at all.
    worker = new Worker(workerUrl(), {
      workerData: request,
      // The worker needs no environment of its own; give it the minimum so a
      // plugin cannot read process-level secrets through it.
      env: {},
      stdout: true,
      stderr: true,
    });
    } catch (error) {
      // Constructing a Worker can fail on its own — a bad path, a policy
      // restriction. That is a rejection like any other, not a crash.
      finish({ ok: false, error: `failed to start sandbox worker: ${(error as Error).message}` });
      return;
    }

    const stdout: string[] = [];

    worker.on('message', (message: unknown) => {
      const response = message as SandboxResponse;
      if (response?.ok) {
        finish({ ok: true, tools: response.tools ?? [], stdout });
      } else {
        finish({ ok: false, error: response?.error ?? 'worker returned no usable response' });
      }
    });

    worker.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));

    worker.on('error', (error) => {
      // Reaching here means the plugin threw at the top level, or the worker
      // itself failed. Either way the engine keeps running.
      finish({ ok: false, error: `plugin worker failed: ${error.message}` });
    });

    worker.on('exit', (code) => {
      // Exit before sending a response means `process.exit()` inside the plugin.
      if (!settled) {
        finish({ ok: false, error: `plugin exited without responding (code ${code})` });
      }
    });


  });
}