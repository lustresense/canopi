# Intentionally runs the exact cleanup script against disposable simulated
# Windows profile locations; never touches the runner's actual user data.
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:TEMP ('cnp-clean-test-' + [guid]::NewGuid().ToString('N'))
$oldA = $env:APPDATA; $oldL = $env:LOCALAPPDATA; $oldU = $env:USERPROFILE
try {
    foreach ($name in @('roaming','local','home','external')) { New-Item -Force -ItemType Directory -Path (Join-Path $base $name) | Out-Null }
    $env:APPDATA = Join-Path $base 'roaming'
    $env:LOCALAPPDATA = Join-Path $base 'local'
    $env:USERPROFILE = Join-Path $base 'home'
    $external = Join-Path $base 'external/protect.txt'
    Set-Content -LiteralPath $external -Value 'MUST_STAY'
    $roots = @((Join-Path $env:APPDATA 'app.canopi.desktop'), (Join-Path $env:LOCALAPPDATA 'app.canopi.desktop'), (Join-Path $env:USERPROFILE '.canopi'))
    foreach ($root in $roots) {
        New-Item -Force -ItemType Directory -Path $root | Out-Null
        Set-Content -LiteralPath (Join-Path $root '.canopi-owner') -Value 'app.canopi.desktop'
        Set-Content -LiteralPath (Join-Path $root 'example-session.txt') -Value 'dummy'
    }
    & "$PSScriptRoot/../src-tauri/windows/uninstall-data.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'Owned root cleanup failed' }
    foreach ($root in $roots) { if (Test-Path $root) { throw 'An owned root survived cleanup unexpectedly' } }
    if (-not (Test-Path -LiteralPath $external)) { throw 'External user project was deleted' }
    $unowned = $roots[0]
    New-Item -Force -ItemType Directory -Path $unowned | Out-Null
    Set-Content -LiteralPath (Join-Path $unowned 'other-app.txt') -Value 'DO NOT DELETE'
    & "$PSScriptRoot/../src-tauri/windows/uninstall-data.ps1" 2>$null
    if ($LASTEXITCODE -eq 0) { throw 'Unowned root was allowed to be deleted' }
    if (-not (Test-Path -LiteralPath (Join-Path $unowned 'other-app.txt'))) { throw 'Unowned data deleted' }
    Write-Host 'PASS: deletes marked canoPi roots, never deletes external or unowned paths'
    exit 0
} finally {
    $env:APPDATA=$oldA; $env:LOCALAPPDATA=$oldL; $env:USERPROFILE=$oldU
    Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
