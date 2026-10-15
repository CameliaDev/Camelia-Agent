# Idempotent local desktop install — one exe layout, one desktop shortcut.
#
# Why this exists: NSIS (desktop:bundle) installs to %LOCALAPPDATA%\Camelia and may
# create Camelia.lnk on the desktop, while dev rebuilds also copy the exe to
# D:\app\Camelia and create another Camelia.lnk. Two launchers with the same label
# look like duplicate shortcuts and can spawn two processes (multiple tray icons).
#
# Usage (from repo root, after desktop:build):
#   powershell -ExecutionPolicy Bypass -File scripts/sync-desktop-install.ps1
#
param(
  [string]$Exe = 'apps/desktop/src-tauri/target/release/camelia-desktop.exe'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Source = if ([System.IO.Path]::IsPathRooted($Exe)) { $Exe } else { Join-Path $Root $Exe }

if (-not (Test-Path -LiteralPath $Source)) {
  throw "Built exe not found at $Source — run 'pnpm --filter @camelia/desktop desktop:build' first."
}

$AppDir = 'D:\app\Camelia'
$LocalDir = Join-Path $env:LOCALAPPDATA 'Camelia'
$DestApp = Join-Path $AppDir 'camelia-desktop.exe'
$DestLocal = Join-Path $LocalDir 'camelia-desktop.exe'

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null

Copy-Item -LiteralPath $Source -Destination $DestApp -Force
Copy-Item -LiteralPath $Source -Destination $DestLocal -Force

$Wsh = New-Object -ComObject WScript.Shell
$ShortcutName = 'Camelia.lnk'
$CanonicalTarget = $DestApp
$CanonicalWorkDir = $AppDir

function Update-Shortcut([string]$Path) {
  $link = $Wsh.CreateShortcut($Path)
  $link.TargetPath = $CanonicalTarget
  $link.WorkingDirectory = $CanonicalWorkDir
  $link.Description = 'Camelia desktop'
  $link.Save()
}

$DesktopCandidates = @(
  (Join-Path $env:USERPROFILE 'Desktop' $ShortcutName),
  (Join-Path $env:PUBLIC 'Desktop' $ShortcutName)
)

# Remove legacy duplicate launchers (exe-on-desktop, old names).
$LegacyPatterns = @(
  (Join-Path $env:USERPROFILE 'Desktop' 'Camelia-Agent-new.exe'),
  (Join-Path $env:USERPROFILE 'Desktop' 'Camelia.exe'),
  (Join-Path $env:PUBLIC 'Desktop' 'Camelia-Agent-new.exe'),
  (Join-Path $env:PUBLIC 'Desktop' 'Camelia.exe')
)
foreach ($legacy in $LegacyPatterns) {
  if (Test-Path -LiteralPath $legacy) {
    Remove-Item -LiteralPath $legacy -Force
    Write-Host "Removed legacy desktop file: $legacy"
  }
}

# Keep a single Camelia.lnk on the user desktop; drop a duplicate on Public desktop.
$UserLnk = $DesktopCandidates[0]
$PublicLnk = $DesktopCandidates[1]
Update-Shortcut $UserLnk
Write-Host "Updated shortcut: $UserLnk -> $CanonicalTarget"

if ((Test-Path -LiteralPath $PublicLnk) -and ($PublicLnk -ne $UserLnk)) {
  Remove-Item -LiteralPath $PublicLnk -Force
  Write-Host "Removed duplicate public-desktop shortcut: $PublicLnk"
}

# Drop any other Camelia*.lnk on the user desktop that point at camelia-desktop.exe.
$UserDesktop = Join-Path $env:USERPROFILE 'Desktop'
Get-ChildItem -LiteralPath $UserDesktop -Filter 'Camelia*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.FullName -eq $UserLnk) { return }
  $sc = $Wsh.CreateShortcut($_.FullName)
  if ($sc.TargetPath -match 'camelia-desktop\.exe$') {
    Remove-Item -LiteralPath $_.FullName -Force
    Write-Host "Removed extra shortcut: $($_.FullName)"
  }
}

Write-Host 'Done. Use the single Camelia shortcut on your user desktop, or run:'
Write-Host "  $CanonicalTarget"
