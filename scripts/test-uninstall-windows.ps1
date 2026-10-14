# Silent install -> verify -> uninstall (Keep default) lifecycle check for the
# canoPi NSIS installer on this machine. Evidence only; no GUI automation.
#  * install silently, verify installed runtime contract (child script)
#  * place marker-owned disposable data roots ONLY where none exist, and
#    snapshot hashes of any pre-existing canoPi data (never modified)
#  * uninstall silently (NSIS /S shows no dialogs => must keep data)
#  * assert app files/registry/shortcuts gone AND canoPi data intact AND no
#    delete-mode receipt created
#  * remove only fixtures this script created
param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [string]$Provenance = '',
    [string]$OutJson = '',
    [string]$ExpectedVersion = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:Checks = @()
function Check([string]$name, [bool]$ok, [string]$detail) {
    $color = if ($ok) { 'Green' } else { 'Red' }
    $status = if ($ok) { 'PASS' } else { 'FAIL' }
    $script:Checks += [ordered]@{ name = $name; result = $status; detail = $detail }
    Write-Host "$status`: $name - $detail" -ForegroundColor $color
}
function Get-TreeHash([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $lines = foreach ($f in (Get-ChildItem -LiteralPath $path -Recurse -File -Force)) {
        $hash = $null
        $retries = 3
        $delayMs = 100
        for ($i = 0; $i -lt $retries; $i++) {
            try {
                $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
                break
            } catch {
                $err = $_
                $isSharing = $err.CategoryInfo.Category -eq 'ReadError' -and $err.FullyQualifiedErrorId -like 'FileReadError*' -and $err.Exception.Message -like '*being used by another process*'
                $isUnauth = $err.CategoryInfo.Category -eq 'ReadError' -and $err.Exception.Message -like '*Access*denied*'
                if (-not ($isSharing -or $isUnauth)) { throw }
                if ($i -eq $retries - 1) {
                    # Deterministic fallback: path + stable metadata
                    $fi = Get-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
                    $meta = "LOCKED|$($f.FullName)|$($fi.Length)|$($fi.LastWriteTimeUtc.ToString('o'))|$($fi.Attributes)"
                    $sha = [Security.Cryptography.SHA256]::Create()
                    $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($meta))) -replace '-', ''
                    $sha.Dispose()
                } else {
                    Start-Sleep -Milliseconds $delayMs
                    $delayMs *= 2
                }
            }
        }
        '{0}|{1}' -f $hash, $f.FullName
    }
    $joined = ($lines | Sort-Object) -join "`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($joined))) -replace '-', '' }
    finally { $sha.Dispose() }
}

$psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell.exe' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$receiptPath = Join-Path $env:LOCALAPPDATA 'canoPi-uninstall-receipt.json'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\canoPi'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$dataRoots = @(
    (Join-Path $env:LOCALAPPDATA 'app.canopi.desktop'),
    (Join-Path $env:APPDATA 'app.canopi.desktop'),
    (Join-Path $env:USERPROFILE '.canopi')
)
$marker = '.canopi-owner'
$appId = 'app.canopi.desktop'

try {
    if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Installer missing: $InstallerPath" }

    # ---- baseline ----------------------------------------------------------
    $preExistingInstall = Test-Path $uninstallKey
    $baselineReceipt = if (Test-Path -LiteralPath $receiptPath) { Get-TreeHash $receiptPath } else { $null }
    $baseline = @{}
    foreach ($r in $dataRoots) { $baseline[$r] = Get-TreeHash $r }
    Check 'baseline recorded' $true "preexistingInstall=$preExistingInstall; data roots baselined=$($dataRoots.Count)"

    # ---- install -----------------------------------------------------------
    $p = Start-Process -FilePath $InstallerPath -ArgumentList '/S' -Wait -PassThru
    Check 'silent installation exits 0' ($p.ExitCode -eq 0) "exit=$($p.ExitCode)"

    # ---- verify installed runtime -----------------------------------------
    $verifyJson = Join-Path ([IO.Path]::GetTempPath()) ('canopi-verify-' + [guid]::NewGuid().ToString('N') + '.json')
    $verifyArgs = @('-OutJson', $verifyJson)
    if ($Provenance) { $verifyArgs += @('-Provenance', $Provenance) }
    if ($ExpectedVersion) { $verifyArgs += @('-ExpectedVersion', $ExpectedVersion) }
    & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/verify-installed-runtime.ps1') @verifyArgs
    Check 'installed runtime verification passed' ($LASTEXITCODE -eq 0) "verify exit=$LASTEXITCODE"

    $instDir = Join-Path $env:LOCALAPPDATA 'canoPi'
    if (Test-Path $uninstallKey) {
        $regDir = (Get-ItemProperty $uninstallKey).InstallLocation
        if ($regDir) { $instDir = "$regDir".Trim('"') }
    }
    $uninstaller = Join-Path $instDir 'uninstall.exe'

    # ---- disposable owned data (Keep assertion target) ---------------------
    $createdRoots = @()
    foreach ($r in $dataRoots) {
        if (-not (Test-Path -LiteralPath $r)) {
            New-Item -ItemType Directory -Path $r -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $r $marker) -Value $appId
            Set-Content -LiteralPath (Join-Path $r 'session-fixture.txt') -Value 'DISPOSABLE_FIXTURE'
            $createdRoots += $r
        }
    }
    $postFixture = @{}
    foreach ($r in $dataRoots) { $postFixture[$r] = Get-TreeHash $r }
    Check 'data fixture/hash snapshot ready' $true "createdRoots=$($createdRoots.Count)"

    # ---- uninstall (silent => no dialogs => Keep data) ----------------------
    Check 'uninstaller present before uninstall' (Test-Path -LiteralPath $uninstaller -PathType Leaf) $uninstaller
    $p = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
    Check 'silent uninstallation exits 0' ($p.ExitCode -eq 0) "exit=$($p.ExitCode)"

    # ---- post-uninstall assertions ----------------------------------------
    Check 'app executable removed' (-not (Test-Path -LiteralPath (Join-Path $instDir 'canoPi.exe'))) $instDir
    Check 'uninstaller removed' (-not (Test-Path -LiteralPath $uninstaller)) $uninstaller
    $leftover = @()
    if (Test-Path -LiteralPath $instDir) {
        $leftover = @(Get-ChildItem -LiteralPath $instDir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object FullName)
    }
    Check 'no leftover files in install directory' ($leftover.Count -eq 0) (($leftover -join '; '))
    Check 'Installed Apps entry removed' (-not (Test-Path $uninstallKey)) $uninstallKey
    $links = @(Get-ChildItem -LiteralPath $startMenu -Recurse -Filter '*canoPi*.lnk' -File -ErrorAction SilentlyContinue)
    Check 'Start Menu shortcuts removed' ($links.Count -eq 0) (($links | ForEach-Object FullName) -join '; ')

    $dataIntact = $true
    $changedRoot = ''
    foreach ($r in $dataRoots) {
        if ((Get-TreeHash $r) -ne $postFixture[$r]) { $dataIntact = $false; $changedRoot = $r; break }
    }
    Check 'WU01/WU08 silent uninstall KEEPS canoPi data (default)' $dataIntact $(if ($dataIntact) { 'all data roots byte-identical' } else { "changed: $changedRoot" })
    Check 'no delete-mode receipt created by Keep uninstall' ((Get-TreeHash $receiptPath) -eq $baselineReceipt) $receiptPath

    # ---- cleanup ONLY fixtures we created ----------------------------------
    foreach ($r in $createdRoots) {
        if (Test-Path -LiteralPath $r) { Remove-Item -LiteralPath $r -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Check 'fixtures removed (pre-existing data untouched)' $true "createdRootsRemoved=$($createdRoots.Count)"

    $failed = @($script:Checks | Where-Object { $_['result'] -eq 'FAIL' })
    $result = [ordered]@{
        schema = 'canopi-install-uninstall-test/1'
        result = if ($failed.Count -eq 0) { 'PASS' } else { 'FAIL' }
        preexistingInstall = $preExistingInstall
        installer = $InstallerPath
        utc = [DateTime]::UtcNow.ToString('o')
        checks = $script:Checks
        note = 'Interactive GUI install/uninstall, WU03 cancel and Delete-mode flows are NOT covered here; they require VM evidence under release/evidence/vm/.'
    }
    if ($OutJson) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutJson) | Out-Null
        ConvertTo-Json -InputObject $result -Depth 6 | Set-Content -LiteralPath $OutJson -Encoding UTF8
    }
    if ($failed.Count -gt 0) { Write-Host "FAIL: $($failed.Count) lifecycle check(s) failed" -ForegroundColor Red; exit 1 }
    Write-Host 'PASS: silent install/verify/uninstall with default Keep data'
    exit 0
} catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
