# Capture the Tauri desktop shell's window to tests/screenshots.
#
# Launches the built release exe, waits for its window, brings it to the foreground,
# then captures the window rectangle with GDI. Capturing the *screen region* (rather
# than PrintWindow) is deliberate: WebView2 renders via DirectComposition, which
# PrintWindow often returns as a blank frame.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/desktop-screenshot.ps1
param(
  [string]$Exe = 'apps/desktop/src-tauri/target/release/camelia-desktop.exe',
  [string]$Out = 'tests/screenshots/desktop.png',
  [string]$Scene = '',
  [int]$WaitMs = 20000,
  [int]$SettleMs = 3500
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CameliaWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

$root = Split-Path -Parent $PSScriptRoot
# Accept an absolute path (e.g. an installed `%LOCALAPPDATA%\Camelia\camelia-desktop.exe`)
# as well as a repo-relative one; `Join-Path` alone would mangle the former into
# `<root>\C:\...` and fail the existence check.
$exePath = if ([System.IO.Path]::IsPathRooted($Exe)) { $Exe } else { Join-Path $root $Exe }
$outPath = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $root $Out }

if (-not (Test-Path $exePath)) {
  throw "desktop executable not found at $exePath - run 'pnpm --filter @camelia/desktop desktop:build' first"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outPath) | Out-Null
[void][CameliaWin]::SetProcessDPIAware()

Write-Host "launching $exePath (scene: $(if ($Scene) { $Scene } else { 'empty' }))"
if ($Scene) {
  $proc = Start-Process -FilePath $exePath -ArgumentList "--scene=$Scene" -PassThru
} else {
  $proc = Start-Process -FilePath $exePath -PassThru
}

$handle = [IntPtr]::Zero
$deadline = (Get-Date).AddMilliseconds($WaitMs)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
  $proc.Refresh()
  if ($proc.HasExited) { throw "desktop process exited early with code $($proc.ExitCode)" }
  if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { $handle = $proc.MainWindowHandle; break }
}

if ($handle -eq [IntPtr]::Zero) {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  throw 'no main window appeared within the timeout'
}

# Foreground the window so the capture shows the app, then let the webview settle.
[void][CameliaWin]::ShowWindow($handle, 5) # SW_SHOW
[void][CameliaWin]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds $SettleMs

$rect = New-Object CameliaWin+RECT
[void][CameliaWin]::GetWindowRect($handle, [ref]$rect)
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
Write-Host "captured ${width}x${height} -> $outPath ($size KB)"