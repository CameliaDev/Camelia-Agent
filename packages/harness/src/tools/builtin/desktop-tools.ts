/**
 * Windows desktop GUI control — scaffolding for real UI Automation.
 *
 * Scope note (honest): this module gives the agent a *real* path onto the Windows
 * desktop (list top-level windows, focus by title, send keys to the foreground
 * window) via PowerShell + UI Automation / SendKeys. It is not yet a full RPA
 * suite (no pixel click grid, no OCR, no control-tree click-by-AutomationId in
 * v1). Those are the next increments; the tool surface is stable so prompts can
 * already ask for "operate the desktop".
 *
 * Risk: `privileged` — gated by ChatPolicy / ApprovalGate like shell. Windows only;
 * non-Windows returns a clear error.
 * @module
 */

import type { JsonValue } from '@camelia/core';

import type { Tool, ToolContext } from '../types.js';

function isWindows(): boolean {
  return process.platform === 'win32';
}

async function runPs(ctx: ToolContext, script: string): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  // ShellPort.exec takes one command string — EncodedCommand avoids quoting hell.
  const result = await ctx.shell.exec(`powershell -NoProfile -EncodedCommand ${encoded}`, {
    cwd: ctx.workspace,
    timeoutMs: 20_000,
  });
  if (result.code !== 0) {
    const err = (result.stderr || result.stdout || `exit ${result.code}`).trim();
    throw new Error(err.slice(0, 500));
  }
  return (result.stdout || '').trim();
}

export const desktopListWindowsTool: Tool<{ limit?: number }, JsonValue> = {
  name: 'desktop_list_windows',
  description: 'List top-level visible Windows desktop windows (title + process). Windows only.',
  usage: [
    'desktop_list_windows(limit?)',
    '- Returns { platform, windows: [{ title, processName, mainWindowHandle }] }.',
    '- Use before desktop_focus_window / desktop_send_keys.',
  ].join('\n'),
  risk: 'privileged',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Max windows (default 30, max 80).' },
    },
    additionalProperties: false,
  },
  async run(input, ctx) {
    if (!isWindows()) throw new Error('desktop_list_windows is only available on Windows');
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 80);
    const script = `
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
  Select-Object -First ${limit} Id, ProcessName, MainWindowTitle, MainWindowHandle
$procs | ForEach-Object {
  [PSCustomObject]@{
    title = $_.MainWindowTitle
    processName = $_.ProcessName
    pid = $_.Id
    mainWindowHandle = [int64]$_.MainWindowHandle
  }
} | ConvertTo-Json -Compress
`.trim();
    const raw = await runPs(ctx, script);
    let windows: JsonValue = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        windows = Array.isArray(parsed) ? (parsed as JsonValue) : ([parsed] as JsonValue);
      } catch {
        windows = [];
      }
    }
    return { platform: 'win32', count: Array.isArray(windows) ? windows.length : 0, windows };
  },
};

export const desktopFocusWindowTool: Tool<{ title: string }, JsonValue> = {
  name: 'desktop_focus_window',
  description: 'Focus a top-level Windows window whose title contains the given text.',
  usage: [
    'desktop_focus_window(title)',
    '- title: substring match against MainWindowTitle (case-insensitive).',
    '- Returns { focused, title, processName } or errors if none match.',
  ].join('\n'),
  risk: 'privileged',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Substring of the window title to focus.' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  async run(input, ctx) {
    if (!isWindows()) throw new Error('desktop_focus_window is only available on Windows');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw new Error('title must be a non-empty string');
    const escaped = title.replace(/'/g, "''");
    const script = `
$needle = '${escaped}'
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and ($_.MainWindowTitle -like ('*' + $needle + '*')) } |
  Select-Object -First 1
if (-not $p) { Write-Error "no window matching: $needle"; exit 1 }
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CameliaWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
[void][CameliaWin]::ShowWindowAsync($p.MainWindowHandle, 9)
[void][CameliaWin]::SetForegroundWindow($p.MainWindowHandle)
@{ focused = $true; title = $p.MainWindowTitle; processName = $p.ProcessName; pid = $p.Id } | ConvertTo-Json -Compress
`.trim();
    const raw = await runPs(ctx, script);
    return JSON.parse(raw || '{"focused":false}') as JsonValue;
  },
};

export const desktopSendKeysTool: Tool<{ keys: string; title?: string }, JsonValue> = {
  name: 'desktop_send_keys',
  description:
    'Send keys to the Windows foreground window (optionally focus by title first). Uses SendKeys syntax.',
  usage: [
    'desktop_send_keys(keys, title?)',
    '- keys: SendKeys string, e.g. "Hello", "^{c}" (Ctrl+C), "{ENTER}".',
    '- title: optional window title substring to focus first.',
    '- Does not click arbitrary screen coordinates yet (scaffolding limit).',
  ].join('\n'),
  risk: 'privileged',
  reversible: false,
  schema: {
    type: 'object',
    properties: {
      keys: { type: 'string', description: 'SendKeys sequence.' },
      title: { type: 'string', description: 'Optional window title substring to focus first.' },
    },
    required: ['keys'],
    additionalProperties: false,
  },
  async run(input, ctx) {
    if (!isWindows()) throw new Error('desktop_send_keys is only available on Windows');
    const keys = typeof input.keys === 'string' ? input.keys : '';
    if (!keys) throw new Error('keys must be a non-empty string');
    if (keys.length > 500) throw new Error('keys too long (max 500)');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const keysEsc = keys.replace(/'/g, "''");
    const titleEsc = title.replace(/'/g, "''");
    const focus = title
      ? `
$needle = '${titleEsc}'
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and ($_.MainWindowTitle -like ('*' + $needle + '*')) } | Select-Object -First 1
if (-not $p) { Write-Error "no window matching: $needle"; exit 1 }
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CameliaWin2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
[void][CameliaWin2]::ShowWindowAsync($p.MainWindowHandle, 9)
[void][CameliaWin2]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 200
`
      : '';
    const script = `
${focus}
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${keysEsc}')
@{ sent = $true; keysLength = ${keys.length} } | ConvertTo-Json -Compress
`.trim();
    const raw = await runPs(ctx, script);
    return JSON.parse(raw || '{"sent":false}') as JsonValue;
  },
};

/** Windows desktop GUI tools (scaffolding). */
export const desktopTools: Tool<any, any>[] = [
  desktopListWindowsTool,
  desktopFocusWindowTool,
  desktopSendKeysTool,
];
