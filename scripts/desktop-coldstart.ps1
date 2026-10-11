# Measure the Tauri window's cold start: process launch -> the webview has painted.
#
# Neither the native window handle (appears in ~50ms) nor a Chromium child window (~80ms)
# is a real readiness signal: both exist while the client area is still a blank rectangle.
# So readiness here is defined as *pixels*: we sample the client area (decorations excluded)
# and require enough distinct colors to prove content was painted.
#
# Prints a single line `coldstart-ms=<median>` so the acceptance report can parse it. The
# process is killed before returning.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/desktop-coldstart.ps1
param(
  [string]$Exe = 'apps/desktop/src-tauri/target/release/camelia-desktop.exe',
  [int]$TimeoutMs = 30000,
  [int]$Runs = 3,
  # A launch can transiently fail to paint (cold WebView2, GPU warm-up, foreground
  # policy denying SetForegroundWindow). Each sample retries the whole launch up to
  # `Attempts` times before being counted as a failure — a single bad frame must
  # not abort the entire measurement.
  [int]$Attempts = 3,
  # A blank client area yields 1-2 distinct colors; any painted UI yields dozens.
  [int]$MinDistinctColors = 12,
  # Readiness also requires the dominant color to BE the app's dark background. A blank
  # WebView2 is white, and Win11's window-open fade blends white with the desktop behind —
  # both produce plenty of distinct colors, so color count alone would declare victory
  # while the client area is still empty.
  [double]$MaxModalLuma = 60,
  [double]$MinModalShare = 0.5,
  # Sample inset (px) from each client edge. Rounded Win11 corners and sub-pixel window
  # placement let a few pixels of whatever is *behind* the window bleed into the capture;
  # without the inset those leaked colors alone can satisfy the threshold.
  [int]$Inset = 24,
  # When set, saves the frame captured at the instant readiness was declared — the
  # evidence that the probe is honest rather than measuring something behind the window.
  [string]$SaveProbe = '',
  # Print each poll's frame statistics. Off by default so the acceptance report parses a
  # single clean line; on when calibrating the readiness thresholds.
  [switch]$Trace
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CameliaColdStart {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][CameliaColdStart]::SetProcessDPIAware()

$root = Split-Path -Parent $PSScriptRoot
$exePath = Join-Path $root $Exe

if (-not (Test-Path $exePath)) {
  throw "desktop executable not found at $exePath - run 'pnpm --filter @camelia/desktop desktop:build' first"
}

# Client-area screen rectangle, so window decorations cannot be mistaken for content.
function Get-ClientScreenRect([IntPtr]$handle) {
  $client = New-Object CameliaColdStart+RECT
  [void][CameliaColdStart]::GetClientRect($handle, [ref]$client)
  $origin = New-Object CameliaColdStart+POINT
  $origin.X = 0; $origin.Y = 0
  [void][CameliaColdStart]::ClientToScreen($handle, [ref]$origin)
  return @{
    X = $origin.X
    Y = $origin.Y
    Width = $client.Right - $client.Left
    Height = $client.Bottom - $client.Top
  }
}

# Sample the client area and describe it: how many distinct colors, and how dominant the
# most common one is.
#
# `CopyFromScreen` reads the screen, so the window MUST be foregrounded first; otherwise we
# would sample whatever sits behind it and report a false "painted".
function Measure-ClientFrame($rect) {
  $x0 = $rect.X + $Inset
  $y0 = $rect.Y + $Inset
  $w = $rect.Width - 2 * $Inset
  $h = $rect.Height - 2 * $Inset
  if ($w -le 0 -or $h -le 0) { return [pscustomobject]@{ Distinct = 0; ModalShare = 0; ModalLuma = 255 } }

  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $gfx.CopyFromScreen($x0, $y0, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $stepX = [math]::Max(1, [int]($w / 60))
    $stepY = [math]::Max(1, [int]($h / 40))
    $counts = @{}
    $total = 0
    for ($y = 0; $y -lt $h; $y += $stepY) {
      for ($x = 0; $x -lt $w; $x += $stepX) {
        $argb = $bmp.GetPixel($x, $y).ToArgb()
        $counts[$argb] = 1 + $(if ($counts.ContainsKey($argb)) { $counts[$argb] } else { 0 })
        $total++
      }
    }
    $modal = $counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
    $color = [System.Drawing.Color]::FromArgb([int]$modal.Key)
    $luma = 0.2126 * $color.R + 0.7152 * $color.G + 0.0722 * $color.B
    return [pscustomobject]@{
      Distinct = $counts.Count
      ModalShare = if ($total) { $modal.Value / $total } else { 0 }
      ModalLuma = $luma
    }
  } finally {
    $gfx.Dispose()
    $bmp.Dispose()
  }
}

$samples = @()
for ($i = 0; $i -lt $Runs; $i++) {
  $proc = $null
  $attempt = 0
  do {
    if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 200 }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $exePath -PassThru
    $pollStart = Get-Date
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    $distinct = 0
    $foregrounded = $false
    $attempt++
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 60
    $proc.Refresh()
    if ($proc.HasExited) { break }
    $handle = $proc.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) { continue }
    if (-not $foregrounded) {
      [void][CameliaColdStart]::ShowWindow($handle, 5) # SW_SHOW
      [void][CameliaColdStart]::SetForegroundWindow($handle)
      $foregrounded = $true
    }
    $frame = Measure-ClientFrame (Get-ClientScreenRect $handle)
    $distinct = $frame.Distinct
    # A dense dark frame (hundreds of distinct colors, dark dominant luma) is
    # unambiguous app content even when no single color holds ≥50% of samples —
    # the share guard exists to reject low-distinct frames (blank white WebView2,
    # desktop bleed behind a not-yet-painted window), not to require a mostly
    # empty window. Content-dense first paints (a rich UI arriving in one frame)
    # legitimately fail the share guard, so escape it when the frame is dense.
    $dense = $frame.Distinct -ge 100 -and $frame.ModalLuma -le $MaxModalLuma
    $painted = $frame.Distinct -ge $MinDistinctColors -and $frame.ModalLuma -le $MaxModalLuma -and ($frame.ModalShare -ge $MinModalShare -or $dense)
    if ($Trace) {
      Write-Host ("  poll {0}ms distinct={1} modalShare={2:N2} modalLuma={3:N0}" -f [int]((Get-Date) - $pollStart).TotalMilliseconds, $frame.Distinct, $frame.ModalShare, $frame.ModalLuma)
    }
    if ($painted) {
      if ($SaveProbe) {
        $probeRect = Get-ClientScreenRect $handle
        $pw = $probeRect.Width - 2 * $Inset
        $ph = $probeRect.Height - 2 * $Inset
        $probeBmp = New-Object System.Drawing.Bitmap($pw, $ph)
        $probeGfx = [System.Drawing.Graphics]::FromImage($probeBmp)
        $probeGfx.CopyFromScreen(($probeRect.X + $Inset), ($probeRect.Y + $Inset), 0, 0, (New-Object System.Drawing.Size($pw, $ph)))
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $root $SaveProbe)) | Out-Null
        $probeBmp.Save((Join-Path $root $SaveProbe), [System.Drawing.Imaging.ImageFormat]::Png)
        $probeGfx.Dispose()
        $probeBmp.Dispose()
      }
      break
    }
  }
  $sw.Stop()
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  if (-not $painted) {
    if ($attempt -lt $Attempts) {
      # Transient first-launch flake (cold WebView2 / foreground policy): retry the
      # whole launch for this sample rather than aborting every remaining run.
      continue
    }
    throw "client area never painted within ${TimeoutMs}ms across $attempt attempts (last: distinct=$($frame.Distinct) modalShare=$($frame.ModalShare) modalLuma=$($frame.ModalLuma))"
  }
  $samples += $sw.ElapsedMilliseconds
  Start-Sleep -Milliseconds 400
  } while ($attempt -lt $Attempts -and -not $painted)
}

# Report the median: a single sample is too sensitive to a cold disk cache.
$sorted = $samples | Sort-Object
$median = $sorted[[int][math]::Floor($sorted.Count / 2)]
Write-Host "coldstart-ms=$median"