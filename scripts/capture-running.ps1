# 截取当前已运行的 Camelia 窗口（不新启实例）。
# 注意：Add-Type 在本机沙箱被拦，所以只用 .NET 内置类型。
param(
  [string]$Out = "tests\screenshots\desktop-live-now.png",
  [string]$ProcessName = "camelia-desktop"
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
     Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) {
  Write-Output "找不到有窗口的进程"
  exit 1
}
Write-Output ("PID={0}  hwnd={1}  title={2}" -f $p.Id, $p.MainWindowHandle, $p.MainWindowTitle)

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output ("screen={0}x{1}" -f $screen.Width, $screen.Height)

$bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output ("captured -> {0}" -f $Out)