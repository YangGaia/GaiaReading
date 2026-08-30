# Convert the source jpg icon in the project root to a 256x256 PNG for electron-builder
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcJpg = Get-ChildItem -LiteralPath $root -Filter *.jpg | Select-Object -First 1
if (-not $srcJpg) {
  Write-Error 'No source jpg icon found in project root.'
}
$src = $srcJpg.FullName
$outDir = Join-Path $root 'build'
$out = Join-Path $outDir 'icon.png'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$img = [System.Drawing.Image]::FromFile($src)
$size = 256
$scale = [Math]::Min($size / $img.Width, $size / $img.Height)
$dw = [int][Math]::Floor($img.Width * $scale)
$dh = [int][Math]::Floor($img.Height * $scale)
$dx = [int][Math]::Floor(($size - $dw) / 2)
$dy = [int][Math]::Floor(($size - $dh) / 2)

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($img, $dx, $dy, $dw, $dh)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$img.Dispose()
Write-Output "Generated $out (source: $src)"