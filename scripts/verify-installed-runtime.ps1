# Verify an INSTALLED canoPi (per-user NSIS) against the packaging contract.
# Read-only: inspects registry, files, shortcuts and bundled resources.
# Emits PASS/FAIL lines plus optional JSON evidence; exit 0 only if every
# hard check passed. Never launches the app, never modifies the system.
param(
    [string]$OutJson = '',
    [string]$Provenance = '',
    [string]$ExpectedVersion = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:Checks = @()
function Check([string]$name, [bool]$ok, [string]$detail, [bool]$hard = $true) {
    $status = if ($ok) { 'PASS' } elseif ($hard) { 'FAIL' } else { 'INFO' }
    $script:Checks += [ordered]@{ name = $name; result = $status; detail = $detail }
    if ($status -eq 'INFO') { Write-Host "INFO: $name - $detail" }
    else { $color = if ($status -eq 'PASS') { 'Green' } else { 'Red' }; Write-Host "$status`: $name - $detail" -ForegroundColor $color }
}
function Is-Mz([string]$path) {
    try {
        $fs = [IO.File]::OpenRead($path)
        try { $a = $fs.ReadByte(); $b = $fs.ReadByte(); return ($a -eq 77 -and $b -eq 90 -and $fs.Length -gt 65536) }
        finally { $fs.Dispose() }
    } catch { return $false }
}

# Locate install dir from the registry (authoritative), then fallbacks.
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\canoPi'
$instDir = ''
if (Test-Path $key) {
    $props = Get-ItemProperty $key
    # StrictMode-safe property access: a missing registry value must not abort
    # the whole verification (it is reported as an empty value instead).
    function Get-Prop([string]$name) { $p = $props.PSObject.Properties[$name]; if ($null -ne $p) { return "$($p.Value)" } return '' }
    $dispName = Get-Prop 'DisplayName'
    $dispVer = Get-Prop 'DisplayVersion'
    $publisher = Get-Prop 'Publisher'
    $icon = (Get-Prop 'DisplayIcon').Trim('"')
    $uninst = Get-Prop 'UninstallString'
    $instDir = (Get-Prop 'InstallLocation').Trim('"')
    Check 'Installed Apps registration (HKCU uninstall key)' ($dispName -eq 'canoPi') "DisplayName=$dispName" $false
    Check 'Registered version' ((-not $ExpectedVersion) -or ($dispVer -eq $ExpectedVersion)) "DisplayVersion=$dispVer expected=$ExpectedVersion" $false
    Check 'Registered publisher' ($publisher -eq 'canoPi Project') "Publisher=$publisher"
    Check 'DisplayIcon points at app executable' ("$instDir\canoPi.exe" -ieq $icon) "DisplayIcon=$icon" $false
    Check 'UninstallString registered' ($uninst -like '*uninstall.exe*') "UninstallString=$uninst" $false
} else {
    Check 'Installed Apps registration (HKCU uninstall key)' $false 'HKCU uninstall key canoPi missing'
}
if (-not $instDir) { $instDir = Join-Path $env:LOCALAPPDATA 'canoPi' }
if (-not (Test-Path -LiteralPath (Join-Path $instDir 'canoPi.exe') -PathType Leaf)) {
    $alt = Join-Path $env:LOCALAPPDATA 'Programs\canoPi'
    if (Test-Path -LiteralPath (Join-Path $alt 'canoPi.exe') -PathType Leaf) { $instDir = $alt }
}
Check 'Install directory resolved' (Test-Path -LiteralPath (Join-Path $instDir 'canoPi.exe') -PathType Leaf) "instDir=$instDir"

# Core installed files.
Check 'canoPi.exe present and PE' (Is-Mz (Join-Path $instDir 'canoPi.exe')) (Join-Path $instDir 'canoPi.exe')
Check 'uninstaller present' (Test-Path -LiteralPath (Join-Path $instDir 'uninstall.exe') -PathType Leaf) 'uninstall.exe'

# Engine at the exact bundled resource mapping: <instDir>\engine\cnp-engine.exe
$engine = Join-Path $instDir 'engine\cnp-engine.exe'
Check 'engine at bundled resource path (engine\cnp-engine.exe)' (Is-Mz $engine) $engine
if ($Provenance -and (Test-Path -LiteralPath $engine -PathType Leaf)) {
    $prov = Get-Content -LiteralPath $Provenance -Raw | ConvertFrom-Json
    $hash = (Get-FileHash -LiteralPath $engine -Algorithm SHA256).Hash
    Check 'installed engine SHA256 matches build provenance' ($hash -eq $prov.compiledEngineSha256) "engine=$hash provenance=$($prov.compiledEngineSha256)"
} else {
    Check 'installed engine SHA256 matches build provenance' $false 'provenance JSON not supplied or engine missing'
}

# Bundled licenses.
Check 'OMP license bundled' (Test-Path -LiteralPath (Join-Path $instDir 'licenses\LICENSE-OMP.txt') -PathType Leaf) 'licenses\LICENSE-OMP.txt'
Check 'OMP third-party notices bundled' (Test-Path -LiteralPath (Join-Path $instDir 'licenses\THIRD-PARTY-NOTICES-OMP.txt') -PathType Leaf) 'licenses\THIRD-PARTY-NOTICES-OMP.txt'

# No developer-runtime dependency inside the install.
$devBins = @(Get-ChildItem -LiteralPath $instDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^(node|bun|npm|cargo|rustc|omp)(\.exe)?$' } | ForEach-Object Name)
Check 'no Node/Bun/Cargo/Rust/omp binaries shipped in install dir' ($devBins.Count -eq 0) (($devBins -join ', '))

# PATH must not be mutated by the installer (no global OMP/cnp PATH entry).
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User') -replace ';+$', ''
$hasPathEntry = $false
if ($userPath) {
    foreach ($seg in ($userPath -split ';')) {
        if ($seg.Trim().TrimEnd('\') -ieq $instDir.TrimEnd('\')) { $hasPathEntry = $true }
    }
}
Check 'install dir NOT added to user PATH' (-not $hasPathEntry) 'no cnp/omp PATH registration expected'

# Start Menu shortcut registered.
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$links = @(Get-ChildItem -LiteralPath $startMenu -Recurse -Filter '*canoPi*.lnk' -File -ErrorAction SilentlyContinue)
Check 'Start Menu shortcut present' ($links.Count -ge 1) (($links | ForEach-Object FullName) -join '; ')

# WebView2 evergreen runtime present (installer provisions per downloadBootstrapper).
$wv = @()
foreach ($hive in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
                    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
                    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
    try { $v = (Get-ItemProperty $hive -ErrorAction Stop).pv; if ($v -and $v -ne '0.0.0.0') { $wv += $v } } catch { }
}
Check 'WebView2 runtime registered' ($wv.Count -gt 0) ("versions: " + ($wv -join ', '))

$failed = @($script:Checks | Where-Object { $_['result'] -eq 'FAIL' })
$result = [ordered]@{
    schema = 'canopi-installed-runtime-check/1'
    result = if ($failed.Count -eq 0) { 'PASS' } else { 'FAIL' }
    installDir = $instDir
    utc = [DateTime]::UtcNow.ToString('o')
    checks = $script:Checks
}
if ($OutJson) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutJson) | Out-Null
    ConvertTo-Json -InputObject $result -Depth 6 | Set-Content -LiteralPath $OutJson -Encoding UTF8
}
if ($failed.Count -gt 0) {
    Write-Host "FAIL: $($failed.Count) installed-runtime check(s) failed" -ForegroundColor Red
    exit 1
}
Write-Host 'PASS: installed runtime matches packaging contract'
exit 0
