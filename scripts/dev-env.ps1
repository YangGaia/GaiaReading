# Dot-source before development: . .\scripts\dev-env.ps1
# Only this PowerShell process and its child processes are changed.
$GaiaDevelopmentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([System.IO.Path]::GetPathRoot($GaiaDevelopmentRoot) -ine 'F:\') {
    throw 'Gaia development files and caches must stay on F:.'
}

$GaiaTemporaryRoot = Join-Path $GaiaDevelopmentRoot '.tmp'
$GaiaCacheRoot = Join-Path $GaiaDevelopmentRoot '.cache'
$GaiaProcessPaths = @{
    TEMP = $GaiaTemporaryRoot
    TMP = $GaiaTemporaryRoot
    TMPDIR = $GaiaTemporaryRoot
    npm_config_cache = (Join-Path $GaiaCacheRoot 'npm')
    npm_config_logs_dir = (Join-Path $GaiaCacheRoot 'npm\_logs')
    npm_config_prefix = (Join-Path $GaiaCacheRoot 'npm-global')
    NODE_COMPILE_CACHE = (Join-Path $GaiaCacheRoot 'node-compile')
    ELECTRON_CACHE = (Join-Path $GaiaCacheRoot 'electron')
    electron_config_cache = (Join-Path $GaiaCacheRoot 'electron')
    ELECTRON_BUILDER_CACHE = (Join-Path $GaiaCacheRoot 'electron-builder')
    APP_BUILDER_TMP_DIR = (Join-Path $GaiaTemporaryRoot 'build')
    XDG_CACHE_HOME = (Join-Path $GaiaCacheRoot 'xdg\cache')
    XDG_CONFIG_HOME = (Join-Path $GaiaCacheRoot 'xdg\config')
    XDG_DATA_HOME = (Join-Path $GaiaCacheRoot 'xdg\data')
    XDG_STATE_HOME = (Join-Path $GaiaCacheRoot 'xdg\state')
    XDG_RUNTIME_DIR = (Join-Path $GaiaTemporaryRoot 'xdg-runtime')
    APPDATA = (Join-Path $GaiaCacheRoot 'appdata')
    LOCALAPPDATA = (Join-Path $GaiaCacheRoot 'localappdata')
    PIP_CACHE_DIR = (Join-Path $GaiaCacheRoot 'pip')
    PYTHONPYCACHEPREFIX = (Join-Path $GaiaCacheRoot 'python')
    UV_CACHE_DIR = (Join-Path $GaiaCacheRoot 'uv')
}

# Check every existing ancestor before creating anything or changing env vars.
foreach ($GaiaTargetPath in $GaiaProcessPaths.Values) {
    $GaiaAncestor = $GaiaTargetPath
    while ($GaiaAncestor) {
        if (Test-Path -LiteralPath $GaiaAncestor) {
            $GaiaItem = Get-Item -LiteralPath $GaiaAncestor -Force
            if (($GaiaItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing a redirected development path: $GaiaAncestor"
            }
        }
        $GaiaParent = Split-Path -Path $GaiaAncestor -Parent
        if ($GaiaParent -eq $GaiaAncestor) { break }
        $GaiaAncestor = $GaiaParent
    }
}
foreach ($GaiaEntry in $GaiaProcessPaths.GetEnumerator()) {
    [System.IO.Directory]::CreateDirectory($GaiaEntry.Value) | Out-Null
    [System.Environment]::SetEnvironmentVariable($GaiaEntry.Key, $GaiaEntry.Value, 'Process')
}
$env:npm_config_userconfig = Join-Path $GaiaCacheRoot 'npm\user.npmrc'
$env:ELECTRON_RUN_AS_NODE = $null

# The second location supports the existing layout until it is moved to 开发.
$GaiaNodeCandidates = @(
    (Join-Path $GaiaDevelopmentRoot '运行环境\node'),
    (Join-Path (Split-Path $GaiaDevelopmentRoot -Parent) 'GaiaReading_Lucky-runtime\node')
)
foreach ($GaiaNodeDirectory in $GaiaNodeCandidates) {
    if (Test-Path -LiteralPath (Join-Path $GaiaNodeDirectory 'node.exe')) {
        $GaiaRemainingPath = @($env:PATH -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $GaiaNodeDirectory.TrimEnd('\') })
        $env:PATH = (@($GaiaNodeDirectory) + $GaiaRemainingPath) -join ';'
        break
    }
}
