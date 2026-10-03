# Keep the original PNG bytes; generate ICO entries only from that PNG.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'assets\icon.png'
if (!(Test-Path -LiteralPath $src -PathType Leaf)) {
  throw 'Original assets/icon.png is missing. Restore it before generating icons.'
}
$outDir = Join-Path $root 'build'
$pngPath = Join-Path $outDir 'icon.png'
$icoPath = Join-Path $outDir 'icon.ico'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item -LiteralPath $src -Destination $pngPath -Force
Write-Output "Copied original PNG to $pngPath"

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
