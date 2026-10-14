# Build the genuine canoPi Windows v1.0 installer on a Windows x64 machine.
# Never substitutes a renamed release binary for the fork build.
#
# Usage:
#   powershell -File scripts\build-windows.ps1                       # source-build the engine here
#   powershell -File scripts\build-windows.ps1 -EngineExe <path> -EngineProvenance <json>
#   powershell -File scripts\build-windows.ps1 -SkipInstallTest      # skip silent install/uninstall verification
#
# Requires: internet, git, Node 22+, npm (lockfile), Python 3, Rust MSVC
# toolchain + Windows SDK + C++ build tools, Bun >= 1.3.14 (only when
# source-building the engine), WebView2 (installer provisions it).
#
# Release artifacts are written to release/ ONLY after every step succeeds.
# Per-step logs: release/_logs/, evidence: release/evidence/.
[CmdletBinding()]
param(
    [string]$EngineExe = '',
    [string]$EngineProvenance = '',
    [switch]$SkipInstallTest,
    [ValidateSet('Development','Signed')]
    [string]$ReleaseMode = 'Development'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$global:LASTEXITCODE = 0

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$pin = (Get-Content 'upstream/PINNED_COMMIT.txt' -Raw).Trim() -split "`r?`n" | Where-Object { $_ -match '^Commit:' } | ForEach-Object { ($_ -split ':', 2)[1].Trim() }
if (-not $pin) { throw 'upstream/PINNED_COMMIT.txt has no Commit line' }
$upstream = Join-Path $root '_upstream/oh-my-pi'
$engineDir = Join-Path $root 'src-tauri/resources/engine'
$licenseDir = Join-Path $root 'src-tauri/resources/licenses'
$releaseDir = Join-Path $root 'release'
$logDir = Join-Path $releaseDir '_logs'
$evidenceDir = Join-Path $releaseDir 'evidence'
$stepsFile = Join-Path $logDir 'steps.json'
$stagedEngine = Join-Path $engineDir 'cnp-engine.exe'
$psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell.exe' }

$script:Steps = @()
function Step-Record([string]$Name, [string]$Status, [int]$ExitCode, [string]$Detail) {
    $script:Steps += [pscustomobject]@{
        name = $Name; status = $Status; exitCode = $ExitCode
        detail = $Detail; utc = [DateTime]::UtcNow.ToString('o')
    }
    try { ConvertTo-Json -InputObject @($script:Steps) -Depth 5 | Set-Content -LiteralPath $stepsFile -Encoding UTF8 } catch { }
}
function Require([string]$exe) {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
        throw "Missing $exe. Install the official prerequisite first, then rerun BUILD-WINDOWS.cmd."
    }
}
function Must([string]$step, [scriptblock]$block) {
    Write-Host "`n=== $step ===" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    $failure = $null
    try { & $block } catch { $failure = $_.Exception.Message }
    if ($null -ne $failure) {
        Step-Record $step 'FAILED' 1 $failure
        Write-Host "FAILED: $failure" -ForegroundColor Red
        throw $failure
    }
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Step-Record $step 'FAILED' $code "exit code $code"
        throw "$step failed with exit code $code"
    }
    Step-Record $step 'PASSED' 0 ''
}
function Tool-Version([string]$exe, [string[]]$ArgumentList) {
    try { $out = (& $exe @ArgumentList) | Out-String; foreach ($line in ($out -split "`r?`n")) { if ($line.Trim()) { return $line.Trim() } }; return '' } catch { return 'unavailable' }
}

$engineStaged = $false
$published = $false
$setupName = ''
$sourceZipName = ''
try {
    # ---------------- preflight -------------------------------------------
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
    if ($env:OS -ne 'Windows_NT') { throw 'Run this on Windows, not Linux.' }
    foreach ($cmd in @('git', 'node', 'npm', 'cargo', 'rustc', 'python')) { Require $cmd }
    if (-not $EngineExe) { Require 'bun' }
    # Resolve the supplied engine BEFORE any step that could alter the
    # worktree or the engine's location (release purge, dedicated upstream
    # reset/patch, staging). A missing engine must fail loudly HERE; failing
    # after the reset steps is misleading because those steps cannot touch
    # this path at all.
    if ($EngineExe) {
        $suppliedEngineFull = (Resolve-Path -LiteralPath $EngineExe).Path
        if (-not (Test-Path -LiteralPath $suppliedEngineFull -PathType Leaf)) {
            throw "Supplied -EngineExe is not a file: $EngineExe"
        }
    }
    # ---------------- Signed mode preflight (fail early before any build work) ---
    if ($ReleaseMode -eq 'Signed') {
        Write-Host "Signed mode preflight: checking certificate prerequisites..." -ForegroundColor Cyan
        if (-not $env:CANOPI_CERT_THUMBPRINT) { throw 'ReleaseMode=Signed requires CANOPI_CERT_THUMBPRINT environment variable (certificate SHA-1 thumbprint)' }
        if (-not $env:CANOPI_CERT_SUBJECT) { throw 'ReleaseMode=Signed requires CANOPI_CERT_SUBJECT environment variable (certificate subject DN)' }
        # Verify cert is in store
        $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint.ToUpper() -eq $env:CANOPI_CERT_THUMBPRINT.ToUpper().Replace(' ', '') }
        if (-not $cert) { throw "Certificate with thumbprint $($env:CANOPI_CERT_THUMBPRINT) not found in CurrentUser\My store. Import .pfx first." }
        if ($cert.Subject -ne $env:CANOPI_CERT_SUBJECT) { throw "Certificate subject mismatch: store has '$($cert.Subject)', expected '$($env:CANOPI_CERT_SUBJECT)'" }
        Write-Host "Certificate preflight OK: $($cert.Thumbprint) / $($cert.Subject)" -ForegroundColor Green
        Require '7z'
    }

    # ---------------- identity / reproducibility audit ---------------------
    Must 'Audit version identity across manifests' {
        $conf = Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
        $pkg = Get-Content 'package.json' -Raw | ConvertFrom-Json
        $cargoRaw = Get-Content 'src-tauri/Cargo.toml' -Raw
        if ($cargoRaw -match '(?m)^\s*version\s*=\s*"([^"]+)"') { $cargoVer = $Matches[1] } else { throw 'src-tauri/Cargo.toml has no version' }
        if (($conf.version -ne $pkg.version) -or ($conf.version -ne $cargoVer)) {
            throw "Version mismatch: tauri.conf.json=$($conf.version) package.json=$($pkg.version) Cargo.toml=$cargoVer. Bump all three together."
        }
        if ($conf.identifier -ne 'app.canopi.desktop') { throw 'Bundle identifier must stay app.canopi.desktop' }
        if ($conf.productName -ne 'canoPi') { throw 'productName must stay canoPi' }
        if ($conf.bundle.resources.'resources/engine/cnp-engine.exe' -ne 'engine/cnp-engine.exe') {
            throw 'Resource mapping must stay resources/engine/cnp-engine.exe -> engine/cnp-engine.exe'
        }
        if ($conf.bundle.windows.nsis.installerHooks -ne './windows/hooks.nsh') { throw 'installerHooks must stay ./windows/hooks.nsh' }
        if (-not $conf.bundle.publisher) { throw 'bundle.publisher missing (Installed Apps would show no publisher)' }
        $script:Version = $conf.version
        Write-Host "version=$($conf.version) identifier=$($conf.identifier) publisher=$($conf.bundle.publisher)"
    }
    Must 'Require dependency lockfiles and a coherent git worktree' {
        if (-not (Test-Path -LiteralPath 'package-lock.json' -PathType Leaf)) {
            throw 'package-lock.json missing. Run: npm install --package-lock-only --no-audit --no-fund, then git add package-lock.json'
        }
        if (-not (Test-Path -LiteralPath 'src-tauri/Cargo.lock' -PathType Leaf)) {
            throw 'src-tauri/Cargo.lock missing. Run: cargo generate-lockfile (in src-tauri), then git add src-tauri/Cargo.lock'
        }
        $porcelain = @(& git status --porcelain -uall)
        $deleted = @($porcelain | Where-Object { $_ -match '^ D' })
        if ($deleted.Count -gt 0) {
            throw ('Tracked files deleted in the worktree but not staged; the source ZIP would not match the built tree: ' + ($deleted -join '; '))
        }
        # Allowlisted untracked files that are intentionally part of source but not yet staged
        $allowedUntracked = @(
            'scripts/upgrade-smoke.ps1',
            'scripts/sign-engine.ps1',
            'scripts/patch-omp.mjs',
            'src-tauri/src/provider_endpoint.rs',
            'src/components/ProviderImport.jsx',
            'src/runtime/event-queue.mjs',
            'src/runtime/tool-activity.mjs',
            'tests/event-queue.test.mjs',
            'tests/tool-activity.test.mjs',
            'docs/TOMORROW_EXECUTION_PLAN.md',
            'patches/omp/0002-canoPi-transport-endpoint-security.patch'
        )
        $untracked = @($porcelain | Where-Object { $_ -match '^\?\?' } | ForEach-Object { $_ -replace '^\?\?\s*', '' } | Where-Object { $allowedUntracked -notcontains $_ })
        if ($untracked.Count -gt 0) {
            throw ('Untracked files present; the source ZIP only ships git-tracked files, so a release build would be unreproducible. Commit or gitignore them: ' + ($untracked -join '; '))
        }
    }

    # ---------------- fresh release staging (evidence preserved) -----------
    $preservedEvidence = $null
    if (Test-Path -LiteralPath $releaseDir) {
        $ev = Join-Path $releaseDir 'evidence'
        if (Test-Path -LiteralPath $ev) {
            $preservedEvidence = Join-Path $env:TEMP ('canopi-evidence-' + [guid]::NewGuid().ToString('N'))
            Move-Item -LiteralPath $ev -Destination $preservedEvidence
        }
        Remove-Item -LiteralPath $releaseDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $engineDir, $licenseDir, $releaseDir, $logDir, $evidenceDir | Out-Null
    if ($preservedEvidence) { Move-Item -LiteralPath $preservedEvidence -Destination (Join-Path $releaseDir 'evidence') }

    # ---------------- environment capture (honest log) ---------------------
    Must 'Capture build environment' {
        $osInfo = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue
        $envJson = [ordered]@{
            utc = [DateTime]::UtcNow.ToString('o')
            os = "$($osInfo.ProductName) build $($osInfo.CurrentBuild).$($osInfo.UBR)"
            arch = $env:PROCESSOR_ARCHITECTURE
            tools = [ordered]@{
                git = Tool-Version 'git' @('--version')
                node = Tool-Version 'node' @('--version')
                npm = Tool-Version 'npm' @('--version')
                bun = Tool-Version 'bun' @('--version')
                cargo = Tool-Version 'cargo' @('--version')
                rustc = Tool-Version 'rustc' @('--version')
                python = Tool-Version 'python' @('--version')
            }
            repoCommit = ((& git rev-parse HEAD 2>&1) | Out-String).Trim()
            repoStatus = ((& git status --porcelain 2>&1) | Out-String).Trim()
            pinnedUpstream = $pin
        }
        ConvertTo-Json -InputObject $envJson -Depth 5 | Set-Content -LiteralPath (Join-Path $logDir 'environment.json') -Encoding UTF8
    }

    # ---------------- pinned upstream source (always needed) ---------------
    if (-not (Test-Path -LiteralPath $upstream -PathType Container)) {
        Must 'Clone pinned upstream OMP source (source, not release binary)' {
            git clone --quiet https://github.com/can1357/oh-my-pi.git $upstream
        }
    }
    Must 'Check out exact pinned OMP commit' { git -C $upstream fetch origin $pin; git -C $upstream checkout --detach $pin }
    $current = (git -C $upstream rev-parse HEAD).Trim()
    if ($current -cne $pin) { throw "Wrong upstream commit $current" }
    # Idempotence on repeated local builds: reset only THE DEDICATED build checkout.
    Must 'Reset dedicated upstream source-build checkout' { git -C $upstream reset --hard $pin }
    Must 'Apply canoPi fork source patch' { node scripts/patch-omp.mjs $upstream }
    Must 'Verify patched fork diff' { git -C $upstream diff --check }
    Copy-Item (Join-Path $upstream 'LICENSE') (Join-Path $licenseDir 'LICENSE-OMP.txt') -Force
    Copy-Item (Join-Path $upstream 'THIRD-PARTY-NOTICES.txt') (Join-Path $licenseDir 'THIRD-PARTY-NOTICES-OMP.txt') -Force

    # ---------------- engine: source-build here, or validate supplied ------
    $engineSource = 'source-built-in-pipeline'
    if ($EngineExe) {
        $engineSource = 'supplied-binary-revalidated'
        $bin = $suppliedEngineFull
        $provPath = $EngineProvenance
        if (-not $provPath) {
            if (Test-Path -LiteralPath 'ENGINE-PROVENANCE.json' -PathType Leaf) { $provPath = 'ENGINE-PROVENANCE.json' }
            else {
                throw ('Supplied engine requires a provenance JSON. Generate it with: ' +
                    'python scripts/verify-engine-provenance.py <pinned-clone> <cnp-engine.exe> ENGINE-PROVENANCE.json')
            }
        }
        Must 'Verify supplied engine provenance against pinned clone' {
            python scripts/verify-engine-provenance.py --verify $provPath $upstream $bin
        }
        $provFull = [IO.Path]::GetFullPath($provPath)
        $provTarget = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path 'ENGINE-PROVENANCE.json'))
        if ($provFull -ine $provTarget) { Copy-Item -LiteralPath $provPath -Destination 'ENGINE-PROVENANCE.json' -Force }
    } else {
        Push-Location $upstream
        try {
            Must 'Install upstream dependencies (bun install; never links a global omp)' { bun install }
            Must 'Compile native engine components' { bun run build:native }
            Must 'Compile cnp engine from forked source' { bun --cwd packages/coding-agent run build }
        } finally { Pop-Location }
        # Bun native Windows compile preserves the requested outfile literally.
        # Prefer that source-built `cnp-engine` output; accept `.exe` if a Bun
        # release changes its native Windows suffix behavior.
        $nativeEngine = Join-Path $upstream 'packages/coding-agent/dist/cnp-engine'
        $exeEngine = Join-Path $upstream 'packages/coding-agent/dist/cnp-engine.exe'
        $bin = if (Test-Path -LiteralPath $nativeEngine -PathType Leaf) { $nativeEngine } else { $exeEngine }
        $engineSource = 'source-built-in-pipeline'
        Must 'Stage validated engine location exists' {
            if (-not (Test-Path -LiteralPath $bin -PathType Leaf)) {
                throw "Source-built cnp engine missing (tried $nativeEngine and $exeEngine)"
            }
        }
        Must 'Generate engine provenance manifest' { python scripts/verify-engine-provenance.py $upstream $bin 'ENGINE-PROVENANCE.json' }
    }

    Must 'Engine is a real Windows PE of plausible size' {
        [byte[]]$header = [IO.File]::ReadAllBytes($bin)
        if ($header.Length -lt 1048576 -or $header[0] -ne 77 -or $header[1] -ne 90) { throw 'Engine is not a real Windows PE executable' }
    }
    Must 'Check engine version' { & $bin --version }
    Must 'Live engine RPC v2 handshake smoke, no provider secrets needed' { python scripts/rpc-smoke.py $bin }

    # ---------------- Sign engine BEFORE bundling (Signed mode only) ---
    if ($ReleaseMode -eq 'Signed') {
        Must 'Authenticode-sign engine binary before bundling' {
            $expectedThumbprint = $env:CANOPI_CERT_THUMBPRINT
            $expectedSubject = $env:CANOPI_CERT_SUBJECT
            if (-not $expectedThumbprint) { throw 'ReleaseMode=Signed requires CANOPI_CERT_THUMBPRINT' }
            if (-not $expectedSubject) { throw 'ReleaseMode=Signed requires CANOPI_CERT_SUBJECT' }
            # Stage engine first, then sign the staged copy (preserve unsigned original for provenance)
            $srcFull = [IO.Path]::GetFullPath($bin)
            $dstFull = [IO.Path]::GetFullPath($stagedEngine)
            # Only a copy THIS script creates is cleaned up in `finally`; a
            # supplied engine already at the resource path is the user's file.
            if ($srcFull -ine $dstFull) { Copy-Item -LiteralPath $bin -Destination $stagedEngine -Force; $engineStaged = $true }
            & "$PSScriptRoot\sign-engine.ps1" -BinaryPath $stagedEngine -Thumbprint $expectedThumbprint -Subject $expectedSubject
        }
    } else {
        # Development mode: just stage unsigned engine
        $srcFull = [IO.Path]::GetFullPath($bin)
        $dstFull = [IO.Path]::GetFullPath($stagedEngine)
        # Only a copy THIS script creates is cleaned up in `finally`; a
        # supplied engine already at the resource path is the user's file.
        if ($srcFull -ine $dstFull) { Copy-Item -LiteralPath $bin -Destination $stagedEngine -Force; $engineStaged = $true }
    }

    # ---------------- stage engine validation (both modes) --
    # tauri-build validates every bundle.resources source path during ANY cargo
    # invocation (cargo test/check), so the engine must be staged before cargo.
    Must 'Validate staged engine' {
        if (-not (Test-Path -LiteralPath $stagedEngine -PathType Leaf)) { throw 'Staging failed' }
        $b = [IO.File]::ReadAllBytes($stagedEngine)
        if ($b.Length -lt 1048576 -or $b[0] -ne 77 -or $b[1] -ne 90) { throw 'Staged engine is not a valid PE' }
    }

    # ---------------- desktop deps, tests, builds ---------------------------
    Must 'Install desktop dependencies from lockfile (npm ci)' { npm ci --no-audit --no-fund }
    Must 'Node runtime and source tests' { npm test }
    Must 'React frontend production build' { npm run build }
    Push-Location 'src-tauri'
    try {
        Must 'Cargo lockfile in sync (cargo fetch --locked)' { cargo fetch --locked }
        Must 'Compile and test Rust' { cargo test }
    } finally { Pop-Location }

    $nsisDir = Join-Path $root 'src-tauri/target/release/bundle/nsis'
    if (Test-Path -LiteralPath $nsisDir) {
        Get-ChildItem -LiteralPath $nsisDir -Filter '*.exe' -File -ErrorAction SilentlyContinue | Remove-Item -Force
    }
    # ---------------- Tauri config override for signing (Signed mode only) ---
    if ($ReleaseMode -eq 'Signed') {
        Must 'Apply Tauri signing config override' {
            $expectedThumbprint = $env:CANOPI_CERT_THUMBPRINT
            $expectedSubject = $env:CANOPI_CERT_SUBJECT
            $timestampUrl = 'http://timestamp.sectigo.com'
            $signScript = (Resolve-Path "$PSScriptRoot\sign-engine.ps1").Path
            $configObj = [ordered]@{
                bundle = @{
                    windows = @{
                        certificateThumbprint = $expectedThumbprint
                        digestAlgorithm = 'sha256'
                        timestampUrl = $timestampUrl
                        tsp = $true
                        signCommand = @{
                            cmd = 'powershell.exe'
                            args = @(
                                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $signScript,
                                '-BinaryPath', '%1',
                                '-Thumbprint', $expectedThumbprint,
                                '-Subject', $expectedSubject,
                                '-TimestampUrl', $timestampUrl
                            )
                        }
                    }
                }
            }
            $configPath = Join-Path $env:TEMP ('tauri-signing-config-' + [guid]::NewGuid().ToString('N') + '.json')
            $configObj | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding UTF8
            $env:TAURI_CONFIG_OVERRIDE_PATH = $configPath
            Write-Host "Tauri signing config override: $configPath"
        }
    }

    Must 'Package NSIS Windows installer (Tauri)' {
        if ($ReleaseMode -eq 'Signed' -and $env:TAURI_CONFIG_OVERRIDE_PATH) {
            npm run package:windows -- --config $env:TAURI_CONFIG_OVERRIDE_PATH
        } else {
            npm run package:windows
        }
    }

    $installers = @(Get-ChildItem -LiteralPath $nsisDir -Filter '*.exe' -File -ErrorAction SilentlyContinue)
    if ($installers.Count -ne 1) { throw "Expected exactly one installer, found $($installers.Count)" }
    $installer = $installers[0]
    Must 'Installer is a real Windows PE of plausible size' {
        $fs = [IO.File]::OpenRead($installer.FullName)
        try { $a = $fs.ReadByte(); $b = $fs.ReadByte(); if ($fs.Length -lt 1048576 -or $a -ne 77 -or $b -ne 90) { throw 'Installer is not a valid-size PE file' } }
        finally { $fs.Dispose() }
    }

    # ---------------- Authenticode signature verification (fail closed for production) ---
    $isSignedBuild = ($ReleaseMode -eq 'Signed')
    $expectedThumbprint = $env:CANOPI_CERT_THUMBPRINT
    $expectedSubject = $env:CANOPI_CERT_SUBJECT
    if ($isSignedBuild) {
        if (-not $expectedThumbprint) { throw 'ReleaseMode=Signed requires CANOPI_CERT_THUMBPRINT environment variable' }
        if (-not $expectedSubject) { throw 'ReleaseMode=Signed requires CANOPI_CERT_SUBJECT environment variable' }
        $expectedThumbprint = $expectedThumbprint.ToUpper().Replace(' ', '')
        Must 'Verify Authenticode signatures on all shipped executables' {
            $bins = @(
                'src-tauri/target/release/canoPi.exe',
                'src-tauri/target/release/engine/cnp-engine.exe',
                $installer.FullName
            )
            foreach ($bin in $bins) {
                if (-not (Test-Path -LiteralPath $bin -PathType Leaf)) {
                    throw "Missing executable for signature verification: $bin"
                }
                $sig = Get-AuthenticodeSignature -FilePath $bin
                $valid = $sig.Status -eq 'Valid'
                $thumbprint = $sig.SignerCertificate.Thumbprint.ToUpper()
                $match = $thumbprint -eq $expectedThumbprint
                $subject = $sig.SignerCertificate.Subject
                $subjectMatch = $subject -eq $expectedSubject
                $tsCert = $sig.TimeStamperCertificate
                if (-not $valid -or -not $match -or -not $subjectMatch -or -not $tsCert) {
                    throw "SIGNATURE FAIL: $bin Status=$($sig.Status) Thumbprint=$thumbprint Expected=$expectedThumbprint Subject=$subject ExpectedSubject=$expectedSubject TimeStamper=$([bool]$tsCert)"
                }
                Write-Host "OK: $bin Valid issuer=$subject Thumbprint=$thumbprint TimeStamper=$($tsCert.Subject)"
            # Verify embedded uninstaller in NSIS installer
            if ($bin -eq $installer.FullName) {
                $extractDir = Join-Path $env:TEMP ('cnp-extract-' + [guid]::NewGuid().ToString('N'))
                try {
                    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
                    # Extract installer using 7z (NSIS installers are extractable)
                    if (Get-Command 7z -ErrorAction SilentlyContinue) {
                        & 7z x $bin -o$extractDir -y | Out-Null
                        $uninstaller = Get-ChildItem -LiteralPath $extractDir -Filter 'uninstall*.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
                        if ($uninstaller) {
                            $uninstSig = Get-AuthenticodeSignature -FilePath $uninstaller.FullName
                            $uninstValid = $uninstSig.Status -eq 'Valid'
                            $uninstThumbprint = $uninstSig.SignerCertificate.Thumbprint.ToUpper()
                            $uninstMatch = $uninstThumbprint -eq $expectedThumbprint
                            $uninstSubject = $uninstSig.SignerCertificate.Subject
                            $uninstSubjectMatch = $uninstSubject -eq $expectedSubject
                            $uninstTsCert = $uninstSig.TimeStamperCertificate
                            if (-not $uninstValid -or -not $uninstMatch -or -not $uninstSubjectMatch -or -not $uninstTsCert) {
                                throw "EMBEDDED UNINSTALLER SIGNATURE FAIL: $($uninstaller.FullName) Status=$($uninstSig.Status) Thumbprint=$uninstThumbprint Expected=$expectedThumbprint Subject=$uninstSubject ExpectedSubject=$expectedSubject TimeStamper=$([bool]$uninstTsCert)"
                            }
                            Write-Host "OK: Embedded uninstaller $($uninstaller.Name) Valid issuer=$uninstSubject Thumbprint=$uninstThumbprint TimeStamper=$($uninstTsCert.Subject)"
                        } else {
                            throw "Embedded uninstaller not found in installer"
                        }
                    } else {
                        throw "7z not available; required for embedded uninstaller verification in Signed mode"
                    }
                } finally {
                    if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
                }
            }
            }
        }
    } else {
        if ($expectedThumbprint) {
            Write-Host "NOTE: CANOPI_CERT_THUMBPRINT set but ReleaseMode=Development; skipping Authenticode gate" -ForegroundColor Yellow
        } else {
            Write-Host "Development build: unsigned (SmartScreen warnings expected)" -ForegroundColor Yellow
        }
        Step-Record 'Authenticode signature verification' 'SKIPPED' 0 'ReleaseMode=Development'
    }

    # ---------------- Update engine provenance with signed engine info (Signed mode only) ---
    if ($isSignedBuild) {
        Must 'Update engine provenance with signed engine hashes' {
            $signedEngine = 'src-tauri/target/release/engine/cnp-engine.exe'
            if (-not (Test-Path -LiteralPath $signedEngine -PathType Leaf)) { throw "Signed engine not found at $signedEngine" }
            $timestampUrl = 'http://timestamp.sectigo.com'
            python scripts/verify-engine-provenance.py --sign-engine 'ENGINE-PROVENANCE.json' $signedEngine $expectedThumbprint $timestampUrl
        }
    }

    # ---------------- safety + lifecycle verification ----------------------
    Must 'Uninstall data cleanup tests on disposable profiles' {
        & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/test-uninstall-data.ps1')
    }
    if (-not $SkipInstallTest) {
        Must 'Silent install/uninstall lifecycle verification (Keep default)' {
            & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/test-uninstall-windows.ps1') `
                -InstallerPath $installer.FullName `
                -Provenance (Join-Path $root 'ENGINE-PROVENANCE.json') `
                -OutJson (Join-Path $evidenceDir 'install-uninstall.json')
        }
    } else {
        Step-Record 'Silent install/uninstall lifecycle verification (Keep default)' 'SKIPPED' 0 '-SkipInstallTest'
    }

    # ---------------- publish release artifacts (success only) --------------
    $ver = $script:Version
    $setupName = "canoPi-Setup-$ver-win-x64.exe"
    $sourceZipName = "canoPi-source-$ver.zip"
    $published = $true
    Must 'Publish installer and provenance to release/' {
        Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $releaseDir $setupName) -Force
        Copy-Item -LiteralPath 'ENGINE-PROVENANCE.json' -Destination (Join-Path $releaseDir 'ENGINE-PROVENANCE.json') -Force
    }
    Must 'Create source ZIP (git-tracked files + lockfiles + allowlisted untracked, no binaries)' {
        $stage = Join-Path $env:TEMP ('canopi-src-' + [guid]::NewGuid().ToString('N'))
        try {
            New-Item -ItemType Directory -Path $stage | Out-Null
            $raw = & git -c core.quotepath=false ls-files
            # Obsolete source-regex tests were intentionally removed; archive the cutover.
            $obsoleteTests = @('tests/native-adapters.test.mjs', 'tests/source-fork.test.mjs')
            $files = @($raw | Where-Object { $_ -and $obsoleteTests -notcontains $_ })
            foreach ($extra in @('package-lock.json', 'src-tauri/Cargo.lock')) {
                if ((Test-Path -LiteralPath $extra -PathType Leaf) -and ($files -notcontains $extra)) { $files += $extra }
            }
            # Include allowlisted untracked source files
            $allowedUntracked = @(
                'scripts/upgrade-smoke.ps1',
                'scripts/sign-engine.ps1',
                'scripts/patch-omp.mjs',
                'src-tauri/src/provider_endpoint.rs',
                'src/components/ProviderImport.jsx',
                'src/runtime/event-queue.mjs',
                'src/runtime/tool-activity.mjs',
                'tests/event-queue.test.mjs',
                'tests/tool-activity.test.mjs',
                'docs/TOMORROW_EXECUTION_PLAN.md',
                'patches/omp/0002-canoPi-transport-endpoint-security.patch'
            )
            foreach ($allowed in $allowedUntracked) {
                if ((Test-Path -LiteralPath $allowed -PathType Leaf) -and ($files -notcontains $allowed)) { $files += $allowed }
            }
            if ($files.Count -lt 10) { throw 'git ls-files returned suspiciously few files' }
            $skipped = @()
            foreach ($rel in $files) {
                if (-not (Test-Path -LiteralPath $rel -PathType Leaf)) { $skipped += $rel; continue }
                $destPath = Join-Path $stage ($rel -replace '[/]', '\')
                $destParent = Split-Path -Parent $destPath
                if (-not (Test-Path -LiteralPath $destParent)) { New-Item -ItemType Directory -Path $destParent -Force | Out-Null }
                Copy-Item -LiteralPath $rel -Destination $destPath -Force
            }
            if ($skipped.Count -gt 0) {
                throw ('Source ZIP would skip tracked files missing from the worktree: ' + ($skipped -join ', '))
            }
            $readme = @(
                'canoPi source ZIP'
                ''
                "Version: $ver"
                'This archive contains the canoPi repository source (git-tracked files and dependency'
                'lockfiles) used to build the matching Windows installer. It is NOT a full monorepo'
                'fork: the upstream Oh My Pi source is NOT included here.'
                ''
                'Reproduce the engine from source:'
                "  1. git clone https://github.com/can1357/oh-my-pi.git"
                "  2. git -C oh-my-pi checkout --detach $pin"
                '  3. node scripts/patch-omp.mjs <clone>   (tracked patch scripts/patch-omp.mjs)'
                '  4. bun install && bun run build:native && bun --cwd packages/coding-agent run build'
                '  5. python scripts/verify-engine-provenance.py <clone> <engine> ENGINE-PROVENANCE.json'
                ''
                'No compiled engine or installer binary is shipped in this source ZIP.'
            ) -join "`r`n"
            Set-Content -LiteralPath (Join-Path $stage 'SOURCE-ZIP-README.txt') -Value $readme -Encoding UTF8
            Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $releaseDir $sourceZipName) -Force
        } finally {
            if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    Must 'Create BUILD-MANIFEST.json' {
        $prov = Get-Content (Join-Path $releaseDir 'ENGINE-PROVENANCE.json') -Raw | ConvertFrom-Json
        $lockRaw = Get-Content 'package-lock.json' -Raw
        $cliMatch = [regex]::Match($lockRaw, '"node_modules/@tauri-apps/cli":\s*\{\s*"version":\s*"([^"]+)"')
        $cliVer = if ($cliMatch.Success) { $cliMatch.Groups[1].Value } else { 'unknown' }
        $cargoLock = Get-Content 'src-tauri/Cargo.lock' -Raw
        $tauriCrate = if ($cargoLock -match '(?s)name = "tauri"\r?\nversion = "([^"]+)"') { $Matches[1] } else { 'unknown' }
        $osInfo = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue
        $manifest = [ordered]@{
            schema = 'canopi-build-manifest/1'
            product = 'canoPi'
            version = $ver
            identifier = 'app.canopi.desktop'
            buildTimeUtc = [DateTime]::UtcNow.ToString('o')
            repoCommit = ((& git rev-parse HEAD) | Out-String).Trim()
            repoWorktreeDirty = [bool]((& git status --porcelain) | Where-Object { $_ })
            upstream = $prov.upstream
            upstreamCommit = $prov.upstreamCommit
            sourcePatchSha256 = $prov.sourcePatchSha256
            engineSource = $engineSource
            engine = [ordered]@{
                name = 'cnp-engine.exe'
                sha256 = $prov.compiledEngineSha256
                bytes = $prov.compiledEngineBytes
            }
            artifacts = [ordered]@{
                installer = $setupName
                installerSha256 = (Get-FileHash -LiteralPath (Join-Path $releaseDir $setupName) -Algorithm SHA256).Hash
                sourceZip = $sourceZipName
                sourceZipSha256 = (Get-FileHash -LiteralPath (Join-Path $releaseDir $sourceZipName) -Algorithm SHA256).Hash
            }
            toolchain = [ordered]@{
                os = "$($osInfo.ProductName) build $($osInfo.CurrentBuild).$($osInfo.UBR)"
                git = Tool-Version 'git' @('--version')
                node = Tool-Version 'node' @('--version')
                npm = Tool-Version 'npm' @('--version')
                bun = Tool-Version 'bun' @('--version')
                cargo = Tool-Version 'cargo' @('--version')
                rustc = Tool-Version 'rustc' @('--version')
                python = Tool-Version 'python' @('--version')
                tauriCli = $cliVer
                tauriCrate = $tauriCrate
                nsis = "bundled with @tauri-apps/cli $cliVer"
            }
            signing = [ordered]@{
                codeSigned = [bool]$expectedThumbprint
                thumbprint = if ($expectedThumbprint) { $expectedThumbprint } else { $null }
                digestAlgorithm = 'sha256'
                timestampUrl = 'http://timestamp.sectigo.com'
                tsp = $true
                note = if ($expectedThumbprint) { 'Authenticode-signed with RFC3161 timestamp; all shipped executables verified against expected thumbprint.' } else { 'Unsigned build. SmartScreen warnings are expected; no signature or reputation is claimed.' }
            }
            tests = @($script:Steps | Where-Object { $_.name -match 'test|smoke|verif|Node runtime|Compile and test|lifecycle|Uninstall data' } |
                ForEach-Object { [ordered]@{ name = $_.name; status = $_.status } })
        }
        ConvertTo-Json -InputObject $manifest -Depth 8 | Set-Content -LiteralPath (Join-Path $releaseDir 'BUILD-MANIFEST.json') -Encoding UTF8
    }
    Must 'Create installer ZIP' {
        $zipStage = Join-Path $env:TEMP ('canopi-zip-' + [guid]::NewGuid().ToString('N'))
        try {
            New-Item -ItemType Directory -Path $zipStage | Out-Null
            Copy-Item -LiteralPath (Join-Path $releaseDir $setupName) -Destination (Join-Path $zipStage $setupName) -Force
            Copy-Item -LiteralPath (Join-Path $releaseDir 'ENGINE-PROVENANCE.json') -Destination (Join-Path $zipStage 'ENGINE-PROVENANCE.json') -Force
            Copy-Item -LiteralPath (Join-Path $releaseDir 'BUILD-MANIFEST.json') -Destination (Join-Path $zipStage 'BUILD-MANIFEST.json') -Force
            $zipSums = foreach ($f in @($setupName, 'ENGINE-PROVENANCE.json', 'BUILD-MANIFEST.json')) {
                '{0}  {1}' -f (Get-FileHash -LiteralPath (Join-Path $zipStage $f) -Algorithm SHA256).Hash, $f
            }
            Set-Content -LiteralPath (Join-Path $zipStage 'SHA256SUMS.txt') -Value ($zipSums -join "`r`n") -Encoding UTF8
            Compress-Archive -Path (Join-Path $zipStage '*') -DestinationPath (Join-Path $releaseDir 'canoPi-windows-installer.zip') -Force
        } finally {
            if (Test-Path -LiteralPath $zipStage) { Remove-Item -LiteralPath $zipStage -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    Must 'Create SHA256SUMS.txt covering release artifacts' {
        $names = @($setupName, $sourceZipName, 'ENGINE-PROVENANCE.json', 'BUILD-MANIFEST.json', 'canoPi-windows-installer.zip')
        $lines = foreach ($n in $names) {
            $p = Join-Path $releaseDir $n
            if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "Missing artifact: $n" }
            '{0}  {1}' -f (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash, $n
        }
        Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -Value ($lines -join "`r`n") -Encoding UTF8
    }
    Step-Record 'BUILD RESULT' 'PASSED' 0 'all publication steps completed'
    Must 'Generate RELEASE_TEST_REPORT.md from observed evidence (last artifact)' {
        & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/collect-release-evidence.ps1') `
            -BuildResult SUCCESS -ReleaseDir $releaseDir -LogDir $logDir
    }

    Write-Host "`nBUILD SUCCEEDED: $(Join-Path $releaseDir $setupName)" -ForegroundColor Green
    Write-Host "INSTALLER ZIP: $(Join-Path $releaseDir 'canoPi-windows-installer.zip')" -ForegroundColor Green
    Write-Host "SOURCE ZIP:    $(Join-Path $releaseDir $sourceZipName)" -ForegroundColor Green
    Write-Host "CHECKSUMS:     $(Join-Path $releaseDir 'SHA256SUMS.txt')" -ForegroundColor Green
    Write-Host "REPORT:        $(Join-Path $releaseDir 'RELEASE_TEST_REPORT.md')" -ForegroundColor Green
    Write-Host "LOGS:          $logDir" -ForegroundColor Green
} catch {
    $err = $_.Exception.Message
    Step-Record 'BUILD RESULT' 'FAILED' 1 $err
    Write-Host "`nBUILD FAILED: $err" -ForegroundColor Red
    if ($published) {
        Write-Host 'Publication had started; removing release artifacts so this failed run leaves no trusted-looking files (logs kept, report regenerated below).' -ForegroundColor Yellow
        foreach ($n in @($setupName, $sourceZipName, 'ENGINE-PROVENANCE.json', 'BUILD-MANIFEST.json', 'SHA256SUMS.txt', 'canoPi-windows-installer.zip', 'RELEASE_TEST_REPORT.md')) {
            if ($n) { Remove-Item -LiteralPath (Join-Path $releaseDir $n) -Force -ErrorAction SilentlyContinue }
        }
    }
    try {
        & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/collect-release-evidence.ps1') `
            -BuildResult ("FAILED - " + ($err -replace '[^\w \\.\:-]', ' ')) -ReleaseDir $releaseDir -LogDir $logDir
    } catch { Write-Host "Report generation also failed: $($_.Exception.Message)" -ForegroundColor Red }
    throw
} finally {
    # Keep the working tree test-clean: remove ONLY a staged copy this script
    # created. A supplied engine already at the resource path is the user's
    # file and must survive the run.
    if ($engineStaged -and (Test-Path -LiteralPath $stagedEngine)) {
        Remove-Item -LiteralPath $stagedEngine -Force -ErrorAction SilentlyContinue
    }
}
