# Generate build/icon.png (256x256) and build/icon.ico (16/32/48/256) from the source jpg icon
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcJpg = Get-ChildItem -LiteralPath (Join-Path $root 'assets') -Filter *.jpg | Select-Object -First 1
if (-not $srcJpg) {
  Write-Error 'No source jpg icon found in project root.'
}
$src = $srcJpg.FullName
$outDir = Join-Path $root 'build'
$pngPath = Join-Path $outDir 'icon.png'
$icoPath = Join-Path $outDir 'icon.ico'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$img = [System.Drawing.Image]::FromFile($src)
$size = 256
$scale = [Math]::Min($size / $img.Width, $size / $img.Height)
$dw = [int][Math]::Floor($img.Width * $scale)
$dh = [int][Math]::Floor($img.Height * $scale)
$dx = [int][Math]::Floor(($size - $dw) / 2)
$dy = [int][Math]::Floor(($size - $dh) / 2)

$bmp = New-Object System.Drawing.Bitmap -ArgumentList $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($img, $dx, $dy, $dw, $dh)
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
$img.Dispose()
Write-Output "Generated $pngPath"

# Build multi-size ICO with PNG-compressed entries (supported by Windows Vista+)
$sizes = @(16, 32, 48, 256)
$pngs = @{}
$srcImg = [System.Drawing.Image]::FromFile($src)
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($srcImg, 0, 0, $s, $s)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs[$s] = $ms.ToArray()
  $ms.Dispose()
  $bmp.Dispose()
}
$srcImg.Dispose()

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($s in $sizes) {
  $dim = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([byte]$dim)
  $bw.Write([byte]$dim)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$pngs[$s].Length)
  $bw.Write([uint32]$offset)
  $offset += $pngs[$s].Length
}
foreach ($s in $sizes) {
  $bw.Write($pngs[$s])
}
$bw.Flush()
$icoBytes = $ms.ToArray()
$bw.Dispose()
$ms.Dispose()
[System.IO.File]::WriteAllBytes($icoPath, $icoBytes)
Write-Output "Generated $icoPath ($($icoBytes.Length) bytes)"
