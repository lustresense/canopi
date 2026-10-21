<#
.SYNOPSIS
    canoPi upgrade smoke test - REQUIRES isolated Windows user account or clean VM.
    Does NOT provide isolation via environment variable redirection alone.

.DESCRIPTION
    This script exercises install/upgrade/uninstall lifecycle using an NSIS installer.
    WARNING: Environment variable redirection (APPDATA/LOCALAPPDATA/USERPROFILE) does NOT
    isolate HKCU registry keys (uninstall registration, Start Menu, known folders).
    The installer WILL write to the CURRENT USER'S HKCU hive and real Start Menu.
    This can affect a live canoPi installation on the same Windows user account.

    For TRUE isolation, run this script under a dedicated disposable Windows user account
    or in a clean Windows VM. The -ProfileRoot parameter only redirects file-system
    data folders; it does NOT sandbox registry or shell integration.

    DO NOT run against your live user profile if you have a canoPi installation you
    want to preserve. Use a throwaway Windows user or VM.

.PARAMETER InstallerPath
    Path to the current version NSIS installer (.exe) to test.

.PARAMETER PriorInstallerPath
    Optional path to a prior version NSIS installer to test upgrade from.

.PARAMETER ProfileRoot
    Optional explicit root for disposable file-system profile data (default: temp GUID).
    ONLY redirects APPDATA/LOCALAPPDATA/USERPROFILE file folders. Does NOT isolate registry.

.PARAMETER KeepProfile
    Do not delete the disposable file-system profile on completion.

.PARAMETER RequireIsolatedUser
    MANDATORY switch. Confirms you are running under an isolated Windows user/VM.
    Script will fail closed without this flag.

.EXAMPLE
    # In a disposable Windows user account or clean VM:
    powershell -File scripts\upgrade-smoke.ps1 -InstallerPath .\canoPi-Setup-1.0.0-win-x64.exe -RequireIsolatedUser

.EXAMPLE
    # Upgrade test (prior -> current) in isolated user/VM:
    powershell -File scripts\upgrade-smoke.ps1 -InstallerPath .\current.exe -PriorInstallerPath .\prior.exe -RequireIsolatedUser
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$InstallerPath,

    [string]$PriorInstallerPath = '',

    [string]$ProfileRoot = '',

    [switch]$KeepProfile,

    [Parameter(Mandatory=$true)]
    [switch]$RequireIsolatedUser
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell.exe' }

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Installer not found: $InstallerPath" }
if ($PriorInstallerPath -and -not (Test-Path -LiteralPath $PriorInstallerPath -PathType Leaf)) { throw "Prior installer not found: $PriorInstallerPath" }

if (-not $ProfileRoot) {
    $ProfileRoot = Join-Path $env:TEMP ('cnp-upgrade-smoke-' + [guid]::NewGuid().ToString('N'))
}
Write-Host "Using disposable file-system profile root: $ProfileRoot" -ForegroundColor Cyan
Write-Host "WARNING: This ONLY redirects file-system folders. HKCU registry and Start Menu are NOT isolated." -ForegroundColor Yellow
Write-Host "You MUST run this under a dedicated disposable Windows user account or clean VM." -ForegroundColor Yellow

$oldA = $env:APPDATA
$oldL = $env:LOCALAPPDATA
$oldU = $env:USERPROFILE

function Invoke-InInstaller([string]$installer, [string]$args) {
    Write-Host "Running: $installer $args" -ForegroundColor Gray
    $p = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Installer exited with code $($p.ExitCode)" }
    $p.ExitCode
}

function Find-InstallDir {
    $uninstKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\canoPi'
    if (Test-Path $uninstKey) {
        $dir = "$((Get-ItemProperty $uninstKey).InstallLocation)".Trim('"')
        if (Test-Path -LiteralPath $dir -PathType Container) { return $dir }
    }
    return Join-Path $env:LOCALAPPDATA 'canoPi'
}

function Verify-Installation {
    $instDir = Find-InstallDir
    Write-Host "Install dir: $instDir" -ForegroundColor Gray
    $app = Join-Path $instDir 'canoPi.exe'
    $engine = Join-Path $instDir 'engine\cnp-engine.exe'
    if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "canoPi.exe not found at $app" }
    if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) { throw "cnp-engine.exe not found at $engine" }
    # Basic engine sanity
    & $engine --version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Engine --version failed after install' }
    Write-Host "Installation verified: $instDir" -ForegroundColor Green
    return $instDir
}

function Verify-DataRoot([string]$root, [string]$label) {
    $marker = Join-Path $root '.canopi-owner'
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw "$label: missing owner marker at $marker" }
    $id = (Get-Content -LiteralPath $marker -Raw -ErrorAction Stop).Trim()
    if ($id -cne 'app.canopi.desktop') { throw "$label: owner marker mismatch: $id" }
    Write-Host "$label: data root OK with valid owner marker" -ForegroundColor Green
}

function Create-ProviderFixture([string]$dataRoot) {
    # Simulate imported provider config (models.yml equivalent) in app-owned data
    $provDir = Join-Path $dataRoot 'providers'
    New-Item -ItemType Directory -Force -Path $provDir | Out-Null
    $modelsYml = @"
providers:
  - name: test-local
    type: openai-completions
    baseUrl: http://127.0.0.1:11434/v1
    apiKey: "test-key-not-real"
    models:
      - name: test-model
        maxTokens: 4096
"@
    Set-Content -LiteralPath (Join-Path $provDir 'models.yml') -Value $modelsYml -Encoding UTF8
    Write-Host "Created provider fixture at $provDir" -ForegroundColor Gray
}

function Create-StaleApprovalFixture([string]$dataRoot) {
    # Simulate stale approval dialog state
    $stateDir = Join-Path $dataRoot 'ui-state'
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    $approvalState = @{
        pendingApprovals = @(@{ id = 'stale-1'; tool = 'bash'; args = @{ command = 'echo stale' }; timestamp = [DateTime]::UtcNow.AddHours(-2).ToString('o') })
        dialogVisible = $true
    }
    $approvalState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stateDir 'approval-state.json') -Encoding UTF8
    Write-Host "Created stale approval fixture at $stateDir" -ForegroundColor Gray
}

try {
    $env:APPDATA = Join-Path $ProfileRoot 'roaming'
    $env:LOCALAPPDATA = Join-Path $ProfileRoot 'local'
    $env:USERPROFILE = Join-Path $ProfileRoot 'home'
    foreach ($d in @($env:APPDATA, $env:LOCALAPPDATA, $env:USERPROFILE)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

    $dataRoots = @(
        Join-Path $env:LOCALAPPDATA 'app.canopi.desktop',
        Join-Path $env:APPDATA 'app.canopi.desktop',
        Join-Path $env:USERPROFILE '.canopi'
    )

    # ---------- Phase 1: Install prior version (if provided) ----------
    if ($PriorInstallerPath) {
        Write-Host "`n=== PHASE 1: Install prior version ===" -ForegroundColor Cyan
        Invoke-InInstaller $PriorInstallerPath '/S'
        $instDir1 = Verify-Installation

        # Create realistic prior-install data: provider config + stale approval state
        foreach ($dr in $dataRoots) {
            if (Test-Path -LiteralPath $dr -PathType Container) {
                $marker = Join-Path $dr '.canopi-owner'
                if (Test-Path -LiteralPath $marker -PathType Leaf) {
                    Create-ProviderFixture $dr
                    Create-StaleApprovalFixture $dr
                    $testFile = Join-Path $dr 'upgrade-test-data.txt'
                    Set-Content -LiteralPath $testFile -Value "Test data from prior install at $([DateTime]::UtcNow.ToString('o'))"
                    Write-Host "Created prior-install fixtures in $dr" -ForegroundColor Gray
                }
            }
        }

        # Verify prior data exists
        $priorDataCount = 0
        foreach ($dr in $dataRoots) {
            if (Test-Path -LiteralPath (Join-Path $dr 'upgrade-test-data.txt') -PathType Leaf) { $priorDataCount++ }
        }
        Write-Host "Prior install data roots with test data: $priorDataCount / $($dataRoots.Count)" -ForegroundColor Cyan
    }

    # ---------- Phase 2: Install/upgrade current version ----------
    Write-Host "`n=== PHASE 2: Install/upgrade current version ===" -ForegroundColor Cyan
    Invoke-InInstaller $InstallerPath '/S'
    $instDir2 = Verify-Installation

    # ---------- Phase 3: Verify data retained after upgrade ----------
    Write-Host "`n=== PHASE 3: Verify data retained after upgrade ===" -ForegroundColor Cyan
    $retainedCount = 0
    foreach ($dr in $dataRoots) {
        Verify-DataRoot $dr "Data root"
        if (Test-Path -LiteralPath (Join-Path $dr 'upgrade-test-data.txt') -PathType Leaf) {
            $content = Get-Content -LiteralPath (Join-Path $dr 'upgrade-test-data.txt') -Raw
            Write-Host "  Retained data in $dr: $content" -ForegroundColor Gray
            $retainedCount++
        }
        # Verify provider fixture survived
        if (Test-Path -LiteralPath (Join-Path $dr 'providers\models.yml') -PathType Leaf) {
            Write-Host "  Provider config retained in $dr" -ForegroundColor Green
        }
        # Verify stale approval state survived (reconnect should handle)
        if (Test-Path -LiteralPath (Join-Path $dr 'ui-state\approval-state.json') -PathType Leaf) {
            Write-Host "  Stale approval state retained in $dr (reconnect must handle)" -ForegroundColor Yellow
        }
    }
    if ($PriorInstallerPath) {
        if ($retainedCount -lt 1) { throw "Expected retained data after upgrade, found none" }
        Write-Host "Upgrade data retention verified: $retainedCount roots retained data" -ForegroundColor Green
    } else {
        Write-Host "Fresh install: no prior data to retain (expected)" -ForegroundColor Green
    }

    # ---------- Phase 4: Uninstall current (Keep default) ----------
    Write-Host "`n=== PHASE 4: Silent uninstall (Keep data default) ===" -ForegroundColor Cyan
    $uninstaller = Join-Path $instDir2 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Uninstaller not found: $uninstaller" }
    $uninst = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($uninst.ExitCode -ne 0) { throw "Uninstall failed with exit code $($uninst.ExitCode)" }

    # Verify app binaries gone, data roots remain (Keep default)
    if (Test-Path -LiteralPath (Join-Path $instDir2 'canoPi.exe') -PathType Leaf) { throw 'canoPi.exe still present after uninstall' }
    if (Test-Path -LiteralPath (Join-Path $instDir2 'engine\cnp-engine.exe') -PathType Leaf) { throw 'cnp-engine.exe still present after uninstall' }

    $preservedCount = 0
    foreach ($dr in $dataRoots) {
        if (Test-Path -LiteralPath $dr -PathType Container) {
            if (Test-Path -LiteralPath (Join-Path $dr '.canopi-owner') -PathType Leaf) {
                Write-Host "Data root preserved (Keep): $dr" -ForegroundColor Green
                $preservedCount++
            }
        }
    }
    if ($preservedCount -lt 1) { throw 'No data root survived uninstall; cannot claim Keep-data behavior' }
    Write-Host "Uninstall (Keep) verified: binaries removed, $preservedCount data root(s) retained with owner markers" -ForegroundColor Green

} finally {
    if (-not $KeepProfile) {
        if (Test-Path -LiteralPath $ProfileRoot) {
            Remove-Item -LiteralPath $ProfileRoot -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "Disposable file-system profile cleaned up: $ProfileRoot" -ForegroundColor Gray
        }
    } else {
        Write-Host "Disposable file-system profile preserved for inspection: $ProfileRoot" -ForegroundColor Yellow
    }
    $env:APPDATA = $oldA
    $env:LOCALAPPDATA = $oldL
    $env:USERPROFILE = $oldU
}