# Source-build cnp-engine.exe from the pinned oh-my-pi checkout at
# upstream/oh-my-pi. This recipe NEVER downloads or renames a prebuilt OMP
# release executable: the artifact identity is produced at build time by the
# tracked patch in patches/omp/0001-cnp-engine-artifact-identity.patch.
#
# Prerequisites: git, node, bun >= 1.3.14, python3, a working Rust linker for
# the pinned nightly (Visual Studio C++ Build Tools provides link.exe; pass
# -RustToolchain to force a specific installed rustup toolchain instead).
# Usage: powershell -File scripts/build-engine.ps1 [-RustToolchain <name>]
param([string]$RustToolchain = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pin = '2a2c6dcbbb558c0f8145f67f28b3370984f2bf60'
$upstream = Join-Path $root 'upstream\oh-my-pi'
$patchFile = Join-Path $root 'patches\omp\0001-cnp-engine-artifact-identity.patch'
$engineDir = Join-Path $root 'src-tauri\resources\engine'

function Must([string]$step, [scriptblock]$block) {
    Write-Host "`n=== $step ===" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath $patchFile -PathType Leaf)) { throw "Tracked fork patch missing: $patchFile" }
foreach ($cmd in @('git', 'node', 'bun', 'python')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Missing $cmd prerequisite" }
}
if (-not (Test-Path -LiteralPath $upstream -PathType Container)) {
    New-Item -ItemType Directory -Force $upstream | Out-Null
    Must 'Clone pinned upstream source' { git -C $upstream init --quiet }
    Must 'Add upstream remote' { git -C $upstream remote add origin https://github.com/can1357/oh-my-pi.git }
    Must 'Fetch exact pinned commit' { git -C $upstream fetch --quiet --depth 1 origin $pin }
}
Must 'Reset dedicated pinned checkout' { git -C $upstream reset --hard $pin }
$current = (git -C $upstream rev-parse HEAD).Trim()
if ($current -cne $pin) { throw "Wrong upstream commit $current" }
Must 'Apply canoPi fork source patch' { node (Join-Path $root 'scripts\patch-omp.mjs') $upstream }
# The tracked patch is the provenance of record: fail on any drift between it
# and what patch-omp.mjs actually applied to this checkout.
Must 'Mark fork marker for diff' { git -C $upstream add -N CANOPI_SOURCE_FORK.md }
$actual = (git -C $upstream diff) -join "`n"
$expected = (Get-Content -LiteralPath $patchFile -Raw) -replace "`r`n", "`n"
if (($actual.TrimEnd() + "`n") -cne $expected.TrimEnd()) { throw 'Applied fork diff drifted from patches/omp/0001-cnp-engine-artifact-identity.patch' }
$buildEnv = @{}
if ($RustToolchain -ne '') { $buildEnv['RUSTUP_TOOLCHAIN'] = $RustToolchain }
# GNU-toolchain fallback (runner has no VS C++ Build Tools): rustup's
# windows-gnu toolchain plus a build-time libnode placeholder in
# upstream/toolchain. The placeholder must leave NO node.dll import in the
# produced addon (objdump -p on the .node must show only system DLLs);
# MSVC builds never need it.
if ($RustToolchain -like '*gnu*') {
    $libnode = Join-Path $root 'upstream\toolchain\libnode.dll'
    if (-not (Test-Path -LiteralPath $libnode)) { throw "GNU toolchain selected but placeholder missing: $libnode" }
    $env:LIBNODE_PATH = Split-Path $libnode -Parent
}
Push-Location $upstream
try {
    if ($buildEnv.Count -gt 0) { foreach ($k in $buildEnv.Keys) { Set-Item -Path "env:$k" -Value $buildEnv[$k] } }
    Must 'Install upstream dependencies' { bun install }
    Must 'Compile native engine components' { bun run build:native }
    Must 'Compile cnp engine from forked source' { bun --cwd packages/coding-agent run build }
} finally { Pop-Location }
$dist = Join-Path $upstream 'packages\coding-agent\dist'
$found = @(Get-ChildItem $dist -File | Where-Object { $_.Name -in @('cnp-engine.exe', 'cnp-engine') })
if ($found.Count -ne 1) { throw 'Source-built cnp-engine output missing or ambiguous' }
$bin = $found[0].FullName
if ([IO.Path]::GetExtension($bin) -eq '.exe') {
    [byte[]]$header = [IO.File]::ReadAllBytes($bin)
    if ($header.Length -lt 1048576 -or $header[0] -ne 77 -or $header[1] -ne 90) { throw 'Engine is not a real Windows PE executable' }
}
Must 'Check engine version' { & $bin --version }
Must 'Run engine self smoke-test' { & $bin --smoke-test }
Must 'Live rpc-ui handshake smoke' { python (Join-Path $root 'scripts\rpc-smoke.py') $bin }
New-Item -ItemType Directory -Force $engineDir | Out-Null
$staged = Join-Path $engineDir ([IO.Path]::GetFileName($bin))
Copy-Item $bin $staged -Force
Must 'Verify engine provenance' { python (Join-Path $root 'scripts\verify-engine-provenance.py') $upstream $staged (Join-Path $root 'ENGINE-PROVENANCE.json') }
Write-Host "`nENGINE BUILT: $staged" -ForegroundColor Green
Write-Host "PROVENANCE: $(Join-Path $root 'ENGINE-PROVENANCE.json')" -ForegroundColor Green
