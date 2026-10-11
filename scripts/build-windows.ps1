# Build the genuine canoPi Windows installer on a Windows x64 machine.
# This script never substitutes a renamed release binary for the fork build.
# Requires an internet connection, git, Python3, Bun >= 1.3.14,
# Node 22+, Rust MSVC toolchain, Windows SDK, C++ build tools, and WebView2.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$pin = (Get-Content 'upstream/PINNED_COMMIT.txt' -Raw).Trim()
$upstream = Join-Path $root '_upstream/oh-my-pi'
$engineDir = Join-Path $root 'src-tauri/resources/engine'
$licenseDir = Join-Path $root 'src-tauri/resources/licenses'
$releaseDir = Join-Path $root 'release'

function Require([string]$exe) {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
        throw "Missing $exe. Install the official prerequisite first, then rerun BUILD-WINDOWS.cmd."
    }
}
function Must([string]$step, [scriptblock]$block) {
    Write-Host "`n=== $step ===" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
if ($env:OS -ne 'Windows_NT') { throw 'Run this on Windows, not Linux.' }
foreach ($cmd in @('git','node','npm','bun','cargo','rustc','python')) { Require $cmd }
New-Item -ItemType Directory -Force $engineDir,$licenseDir,$releaseDir | Out-Null
if (-not (Test-Path -LiteralPath $upstream -PathType Container)) {
    Must 'Clone pinned upstream OMP source' { git clone --quiet https://github.com/can1357/oh-my-pi.git $upstream }
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
Push-Location $upstream
try {
    Must 'Install OMP source dependencies / generate native assets' { bun setup }
    Must 'Compile native cnp engine from forked source' { bun --cwd packages/coding-agent run build }
} finally { Pop-Location }
$dist = Join-Path $upstream 'packages/coding-agent/dist'
$found = @(Get-ChildItem $dist -File | Where-Object { $_.Name -in @('cnp-engine.exe','cnp-engine') })
if ($found.Count -ne 1) { throw 'Source-built cnp-engine output missing or ambiguous' }
$bin = $found[0].FullName
[byte[]]$header = [IO.File]::ReadAllBytes($bin)
if ($header.Length -lt 1048576 -or $header[0] -ne 77 -or $header[1] -ne 90) { throw 'Engine is not a real Windows PE executable' }
Must 'Check engine version' { & $bin --version }
Must 'Live engine RPC smoke, no provider secrets needed' { python scripts/rpc-smoke.py $bin }
Copy-Item $bin (Join-Path $engineDir 'cnp-engine.exe') -Force
Must 'Verify engine provenance' { python scripts/verify-engine-provenance.py $upstream (Join-Path $engineDir 'cnp-engine.exe') ENGINE-PROVENANCE.json }
Must 'Install React/Tauri dependencies' { npm install --no-audit --no-fund }
Must 'Run Node runtime and source tests' { npm test }
Must 'Build the real React frontend' { npm run build }
Push-Location 'src-tauri'
try { Must 'Compile and test Rust' { cargo test } } finally { Pop-Location }
Must 'Build Tauri Windows installer' { npm run package:windows }
$nsis = Join-Path $root 'src-tauri/target/release/bundle/nsis'
$installers = @(Get-ChildItem $nsis -Filter *.exe -File)
if ($installers.Count -ne 1) { throw "Expected one installer, found $($installers.Count)" }
$installer = $installers[0]
$stream = [IO.File]::OpenRead($installer.FullName)
try { $a=$stream.ReadByte(); $b=$stream.ReadByte(); if($stream.Length -lt 1048576 -or $a -ne 77 -or $b -ne 90) {throw 'Installer is not a valid-size PE file'} }
finally { $stream.Dispose() }
Must 'Test data cleanup with disposable folders' { & ./scripts/test-uninstall-data.ps1 }
Copy-Item $installer.FullName (Join-Path $releaseDir $installer.Name) -Force
Copy-Item 'ENGINE-PROVENANCE.json' (Join-Path $releaseDir 'ENGINE-PROVENANCE.json') -Force
Get-FileHash (Join-Path $releaseDir $installer.Name) -Algorithm SHA256 | ForEach-Object { "$($_.Hash)  $($installer.Name)" } | Set-Content (Join-Path $releaseDir 'SHA256SUMS.txt')
Compress-Archive -Path (Join-Path $releaseDir $installer.Name),(Join-Path $releaseDir 'SHA256SUMS.txt'),(Join-Path $releaseDir 'ENGINE-PROVENANCE.json') -DestinationPath (Join-Path $releaseDir 'canoPi-windows-installer.zip') -Force
Write-Host "`nBUILD SUCCEEDED: $(Join-Path $releaseDir $installer.Name)" -ForegroundColor Green
Write-Host "INSTALLER ZIP: $(Join-Path $releaseDir 'canoPi-windows-installer.zip')" -ForegroundColor Green
