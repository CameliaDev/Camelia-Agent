# Capture the desktop shell attached to a *real* `camelia serve` engine.
#
# `desktop-screenshot.ps1` proves the shell can project a scripted fixture. This script
# proves the harder half: the shell carries `--engine-url` into the webview, the SSE
# transport attaches to a live engine, and the window shows the engine's event stream —
# which is the actual Phase 3 contract. It boots `camelia serve --mock`, reads the URL
# from the JSON banner, launches the exe pointed at it, and captures the window with GDI
# (screen-region capture, because WebView2 renders via DirectComposition and PrintWindow
# returns blank frames).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/desktop-live-shot.ps1
param(
  [string]$Exe = 'apps/desktop/src-tauri/target/release/camelia-desktop.exe',
  [string]$Out = 'tests/screenshots/desktop-live.png',
  [int]$WaitMs = 25000,
  [int]$SettleMs = 4000,
  [int]$ApprovalTimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CameliaLiveWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

$root = Split-Path -Parent $PSScriptRoot
$exePath = if ([System.IO.Path]::IsPathRooted($Exe)) { $Exe } else { Join-Path $root $Exe }
$outPath = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $root $Out }
$cli = Join-Path $root 'packages/cli/dist/bin.js'
$spec = Join-Path $root 'scripts/fixtures/live-demo.spec.json'

foreach ($required in @($exePath, $cli, $spec)) {
  if (-not (Test-Path $required)) { throw "missing required artifact: $required" }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outPath) | Out-Null
[void][CameliaLiveWin]::SetProcessDPIAware()

$workspace = Join-Path ([System.IO.Path]::GetTempPath()) ("camelia-live-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
$bannerFile = Join-Path $workspace 'banner.json'

# Boot the engine; --json makes it print a single JSON banner once it is listening.
$engine = Start-Process -FilePath 'node' -ArgumentList @(
  $cli, 'serve', '--mock', '--spec', $spec, '--auto-run',
  'add a live demo note and confirm node is available',
  '--port', '0', '--json', '--approval-timeout', "$ApprovalTimeoutSec",
  '--workspace', $workspace
) -PassThru -RedirectStandardOutput $bannerFile -RedirectStandardError (Join-Path $workspace 'engine.err') -WindowStyle Hidden

try {
  $url = $null
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    if (Test-Path $bannerFile) {
      try { $url = (Get-Content $bannerFile -Raw | ConvertFrom-Json).url } catch { $url = $null }
    }
    if ($url) { break }
  }
  if (-not $url) { throw "engine did not report a URL within 25s (see $workspace\engine.err)" }
  Write-Host "engine    $url"

  # Launch the shell pointed at the live engine.
  $proc = Start-Process -FilePath $exePath -ArgumentList "--engine-url=$url" -PassThru

  $handle = [IntPtr]::Zero
  $deadline = (Get-Date).AddMilliseconds($WaitMs)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    $proc.Refresh()
    if ($proc.HasExited) { throw "desktop process exited early with code $($proc.ExitCode)" }
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { $handle = $proc.MainWindowHandle; break }
  }
  if ($handle -eq [IntPtr]::Zero) { throw 'no main window appeared within the timeout' }

  [void][CameliaLiveWin]::ShowWindow($handle, 5)
  [void][CameliaLiveWin]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds $SettleMs

  $rect = New-Object CameliaLiveWin+RECT
  [void][CameliaLiveWin]::GetWindowRect($handle, [ref]$rect)
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top

  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
  $bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()

  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  $size = [math]::Round((Get-Item $outPath).Length / 1KB, 1)
  Write-Host "captured ${width}x${height} -> $outPath ($size KB)  [attached to $url]"
} finally {
  Stop-Process -Id $engine.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $workspace -ErrorAction SilentlyContinue
}