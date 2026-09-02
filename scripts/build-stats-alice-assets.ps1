$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$petRoot = Join-Path $projectRoot 'src\renderer\images\pet'
$basePath = Join-Path $petRoot 'cells\半身照.png'
$outputDirectory = Join-Path $petRoot 'stats'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

# Face patches are authored against the original 356 x 647 portrait.
$faceLeft = 111
$faceTop = 117
$expressions = [ordered]@{
  'idle.png' = '日常表情.png'
  'blink.png' = '安心.png'
  'drowsy.png' = '眼睛微张.png'
  'yawn.png' = '打哈欠.png'
}

foreach ($entry in $expressions.GetEnumerator()) {
  $base = [System.Drawing.Bitmap]::new($basePath)
  $face = [System.Drawing.Bitmap]::new((Join-Path $petRoot ('faces\' + $entry.Value)))
  $result = [System.Drawing.Bitmap]::new($base.Width, $base.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($result)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.DrawImageUnscaled($base, 0, 0)
  $graphics.DrawImageUnscaled($face, $faceLeft, $faceTop)

  $stream = [System.IO.File]::Open(
    (Join-Path $outputDirectory $entry.Key),
    [System.IO.FileMode]::Create,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  try {
    $result.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $stream.Dispose()
    $graphics.Dispose()
    $result.Dispose()
    $face.Dispose()
    $base.Dispose()
  }
}
