param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

# Read-only local verification. Release binaries and reports are not stored in Git.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$dist = (Resolve-Path -LiteralPath (Join-Path $project 'dist')).Path
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$fileName = "Gaia.Reading.$version.exe"
$executable = Join-Path $dist $fileName
$script:distChecks = 0

function Assert-Dist([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:distChecks++
}

function Test-ReleaseFile([string]$Path, [string]$Version) {
    Assert-Dist (Test-Path -LiteralPath $Path -PathType Leaf) "Missing executable: $Path"
    $notesPath = Join-Path $project "RELEASE_NOTES_$Version.md"
    $notes = Get-Content -LiteralPath $notesPath -Raw
    $expectedHash = [regex]::Match($notes, 'SHA-256：`([A-F0-9]{64})`').Groups[1].Value
    $expectedSize = [regex]::Match($notes, '文件大小：([\d,]+) 字节').Groups[1].Value.Replace(',', '')
    Assert-Dist ($expectedHash.Length -eq 64 -and $expectedSize.Length -gt 0) "Missing release checksum or size: $notesPath"
    $file = Get-Item -LiteralPath $Path
    Assert-Dist ($file.Length -eq [long]$expectedSize) "Executable size mismatch: $Path"
    Assert-Dist ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $expectedHash) "Executable checksum mismatch: $Path"
    Assert-Dist ($file.VersionInfo.ProductVersion -eq $Version) "Executable version mismatch: $Path"
}

$expectedEntries = @('archive', 'previews', 'reports', $fileName) | Sort-Object
$actualEntries = @(Get-ChildItem -LiteralPath $dist -Force | ForEach-Object Name | Sort-Object)
Assert-Dist (@(Compare-Object $expectedEntries $actualEntries).Count -eq 0) 'dist must contain only the current exe, archive, previews and reports'
Assert-Dist (-not ((Get-Item -LiteralPath $dist -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'dist cannot be a reparse point'
Assert-Dist (@(Get-ChildItem -LiteralPath $dist -Force -Recurse -Attributes ReparsePoint).Count -eq 0) 'dist cannot contain reparse points'
Test-ReleaseFile $executable $version

$archive = @(Get-ChildItem -LiteralPath (Join-Path $dist 'archive') -Force)
Assert-Dist ($archive.Count -eq 1) 'Keep exactly one previous release for rollback'
foreach ($file in $archive) {
    $match = [regex]::Match($file.Name, '^Gaia\.Reading\.(\d+\.\d+\.\d+)\.exe$')
    Assert-Dist (-not $file.PSIsContainer -and $match.Success) "Unexpected archive item: $($file.Name)"
    $archivedVersion = $match.Groups[1].Value
    Assert-Dist ([version]$archivedVersion -lt [version]$version) 'Rollback release must be older than the current version'
    Test-ReleaseFile $file.FullName $archivedVersion
}

$reportRoot = Join-Path $dist "reports\$version"
foreach ($suite in @('reader', 'ui', 'epub-font')) {
    $suiteRoot = Join-Path $reportRoot $suite
    $report = Get-Content -LiteralPath (Join-Path $suiteRoot 'report.json') -Raw | ConvertFrom-Json
    Assert-Dist ($report.passed -eq $true) "Archived $suite checks did not pass"
    # Reports preserve the original run paths; archived images keep their names.
    foreach ($shot in $report.screenshots) {
        Assert-Dist (Test-Path -LiteralPath (Join-Path $suiteRoot ([IO.Path]::GetFileName($shot))) -PathType Leaf) "Missing archived screenshot: $shot"
    }
}
$releaseReport = Get-Content -LiteralPath (Join-Path $reportRoot 'release\published-check.json') -Raw | ConvertFrom-Json
Assert-Dist ($releaseReport.passed -eq $true -and $releaseReport.tag -eq "v$version") 'Missing successful publication verification'
Assert-Dist ((Get-FileHash -LiteralPath $executable).Hash -eq $releaseReport.sha256) 'Local exe differs from the published release'
$preview = Join-Path $dist "previews\$version\music-marquee.gif"
Assert-Dist ((Test-Path -LiteralPath $preview -PathType Leaf) -and (Get-Item -LiteralPath $preview).Length -gt 0) 'Missing music marquee preview'

$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) "Gaia.Reading.$version.lnk"
Assert-Dist (Test-Path -LiteralPath $shortcutPath -PathType Leaf) 'Desktop shortcut is missing'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
Assert-Dist ($shortcut.TargetPath -eq $executable) 'Desktop shortcut points at the wrong executable'
Assert-Dist ($shortcut.WorkingDirectory -eq $dist) 'Desktop shortcut has the wrong working directory'
Assert-Dist ($shortcut.IconLocation -eq ($executable + ',0')) 'Desktop shortcut icon still points at an old path'

[ordered]@{
    Passed = $true
    Checks = $script:distChecks
    Version = $version
    Executable = $executable
    Shortcut = $shortcutPath
    TopLevelEntries = $actualEntries
} | ConvertTo-Json -Depth 3
