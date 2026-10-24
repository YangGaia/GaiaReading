param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$DesktopPath = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$desktop = (Resolve-Path -LiteralPath $DesktopPath).Path
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$name = "Gaia.Reading.$($package.version)"
$dist = Join-Path $project 'dist'
$exe = Join-Path $dist "$name.exe"
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Release executable does not exist: $exe" }
if (Test-Path -LiteralPath (Join-Path $desktop "$name.exe")) { throw 'Desktop already contains a copy of this exe; keep the release executable in dist.' }
$shortcutPath = Join-Path $desktop "$name.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $dist
$shortcut.IconLocation = $exe + ',0'
$shortcut.Description = "Gaia Reading $($package.version)"
$shortcut.Save()
[ordered]@{ Shortcut = $shortcutPath; Target = $exe; WorkingDirectory = $dist; DesktopExe = $false } | ConvertTo-Json
