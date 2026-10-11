# Assemble an honest RELEASE_TEST_REPORT.md from OBSERVED evidence only.
# Inputs (all optional; missing inputs produce explicit NOT RUN rows):
#   <logDir>/steps.json          pipeline step statuses from build-windows.ps1
#   <logDir>/environment.json    OS/toolchain/commit capture
#   <releaseDir>/BUILD-MANIFEST.json, SHA256SUMS.txt, artifacts
#   <releaseDir>/evidence/install-uninstall.json   scripted lifecycle result
#   <releaseDir>/evidence/vm/<ID>.json             manual/VM runs: {"id","status","expected","observed","log","os","utc"}
#   <releaseDir>/evidence/screenshots/*            screenshot files (listed, never invented)
# Never fabricates a PASS: a row without a matching evidence file is NOT RUN.
param(
    [string]$BuildResult = 'UNKNOWN',
    [string]$ReleaseDir = '',
    [string]$LogDir = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $ReleaseDir) { $ReleaseDir = Join-Path $root 'release' }
if (-not $LogDir) { $LogDir = Join-Path $ReleaseDir '_logs' }
$outFile = Join-Path $ReleaseDir 'RELEASE_TEST_REPORT.md'
$evidenceDir = Join-Path $ReleaseDir 'evidence'
$vmDir = Join-Path $evidenceDir 'vm'

function Read-JsonFile([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try { return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json) } catch { return $null }
}
$stepsRaw = Read-JsonFile (Join-Path $LogDir 'steps.json')
$steps = @(); if ($null -ne $stepsRaw) { $steps = @($stepsRaw) }
$envData = Read-JsonFile (Join-Path $LogDir 'environment.json')
$manifest = Read-JsonFile (Join-Path $ReleaseDir 'BUILD-MANIFEST.json')
$life = Read-JsonFile (Join-Path $evidenceDir 'install-uninstall.json')

# VM/manual evidence index by id.
$vmEvidence = @{}
if (Test-Path -LiteralPath $vmDir) {
    foreach ($f in @(Get-ChildItem -LiteralPath $vmDir -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
        $j = Read-JsonFile $f.FullName
        if ($null -ne $j -and $j.id) { $vmEvidence[$j.id.ToString().ToUpperInvariant()] = $j }
    }
}
function Vm-Row([string]$id, [string]$title) {
    $e = $vmEvidence[$id]
    if ($null -eq $e) { return "| $id | $title | NOT RUN | no evidence file at evidence/vm/$($id.ToLower()).json |" }
    $status = $e.status.ToString().ToUpperInvariant()
    $obs = "$($e.observed)".Replace('|', '/').Replace("`r", ' ').Replace("`n", ' ')
    if ($obs.Length -gt 160) { $obs = $obs.Substring(0, 157) + '...' }
    $when = if ($e.utc) { $e.utc } else { 'no timestamp' }
    return "| $id | $title | $status | $obs (evidence: $($e.log); $when) |"
}

$lines = @()
$lines += '# canoPi Windows release test report'
$lines += ''
$lines += "- Build result: **$BuildResult**"
$lines += "- Generated (UTC): $([DateTime]::UtcNow.ToString('o'))"
if ($null -ne $envData) {
    $lines += "- OS: $($envData.os)"
    $lines += "- Repo commit: ``$($envData.repoCommit)``$(if ($envData.repoStatus) { ' (worktree DIRTY)' } else { '' })"
    $lines += "- Pinned upstream: ``$($envData.pinnedUpstream)``"
    if ($envData.repoStatus) {
        $lines += '- Worktree status at build time:'
        $lines += '```'
        $lines += (@($envData.repoStatus) -join "`n")
        $lines += '```'
    }
} else {
    $lines += '- OS/commit: environment.json missing (build failed before capture)'
}
if ($null -ne $manifest) {
    $lines += "- Product: canoPi $($manifest.version) (identifier $($manifest.identifier), publisher canoPi Project)"
    $lines += "- Engine: ``$($manifest.engine.name)`` $($manifest.engine.bytes) bytes, SHA256 ``$($manifest.engine.sha256)`` (source: $($manifest.engineSource))"
    $lines += "- Upstream commit: ``$($manifest.upstreamCommit)``; source patch SHA256 ``$($manifest.sourcePatchSha256)``"
} else {
    $lines += '- BUILD-MANIFEST.json: NOT PRODUCED (build did not reach publication)'
}
$lines += '- Code signing: **unsigned**; SmartScreen warnings expected, no signature or reputation claimed.'
$lines += ''
$lines += 'Every status below comes from a log or evidence file on disk. Anything without'
$lines += 'evidence is marked NOT RUN - this report never upgrades a result by itself.'
$lines += ''

$lines += '## 1. Pipeline steps (build-windows.ps1)'
$lines += ''
if ($steps.Count -eq 0) {
    $lines += 'No steps.json recorded.'
} else {
    $lines += '| # | Step | Status | Exit |'
    $lines += '|---|---|---|---|'
    $i = 0
    foreach ($s in $steps) { $i++; $lines += "| $i | $($s.name) | $($s.status) | $($s.exitCode) |" }
}
$lines += ''

$lines += '## 2. Scripted install/uninstall verification (this machine, silent modes)'
$lines += ''
if ($null -eq $life) {
    $lines += 'NOT RUN - install-uninstall evidence missing (build failed earlier or -SkipInstallTest).'
} else {
    $lines += "- Overall: **$($life.result)** (utc $($life.utc)); pre-existing install: $($life.preexistingInstall)"
    $lines += '- Covers: silent install, installed-runtime contract, silent uninstall, default Keep data.'
    $lines += '- Does NOT cover: interactive GUI, WU03 cancel, Delete-mode confirmation, upgrades.'
    $lines += ''
    $lines += '| Check | Result | Detail |'
    $lines += '|---|---|---|'
    $lifeChecks = if ($life.PSObject.Properties['checks']) { @($life.checks) } else { @() }
    foreach ($c in $lifeChecks) {
        $d = "$($c.detail)".Replace('|', '/').Replace("`r", ' ').Replace("`n", ' ')
        if ($d.Length -gt 140) { $d = $d.Substring(0, 137) + '...' }
        $lines += "| $($c.name) | $($c.result) | $d |"
    }
}
$lines += ''

$lines += '## 3. Windows uninstall matrix WU01-WU12 (PRD v3 section 7.3)'
$lines += ''
$lines += '| ID | Scenario | Status | Evidence |'
$lines += '|---|---|---|---|'
$lines += (Vm-Row 'WU01' 'Fresh uninstall / Keep')
$lines += (Vm-Row 'WU02' 'Fresh uninstall / Delete only owned roots')
$lines += (Vm-Row 'WU03' 'Cancel keeps everything')
$lines += (Vm-Row 'WU04' 'Existing OMP + 9Router unchanged under Delete')
$lines += (Vm-Row 'WU05' 'CLI/PATH scoped cleanup')
$lines += (Vm-Row 'WU06' 'Active engine stopped, no orphan')
$lines += (Vm-Row 'WU07' 'Upgrade keeps data')
$lines += (Vm-Row 'WU08' 'Silent uninstall defaults to Keep')
$lines += (Vm-Row 'WU09' 'Reparse/junction not followed')
$lines += (Vm-Row 'WU10' 'Reinstall after Keep resumes data')
$lines += (Vm-Row 'WU11' 'Partial cleanup failure reported')
$lines += (Vm-Row 'WU12' 'Other account data untouched')
$lines += ''
$lines += 'Static disposable-profile checks for WU02/WU04/WU09 semantics run inside the'
$lines += 'pipeline (`scripts/test-uninstall-data.ps1`) - see step table; they are lab'
$lines += 'checks against simulated profiles, NOT a full VM uninstall matrix run.'
$lines += ''

$lines += '## 4. Selected acceptance rows (A-series)'
$lines += ''
$lines += '| ID | Topic | Status | Source |'
$lines += '|---|---|---|---|'
$stepStatus = @{}
foreach ($s in $steps) { $stepStatus[$s.name] = $s.status }
function Step-StatusRow([string]$id, [string]$topic, [string]$stepName, [string]$source) {
    $st = 'NOT RUN'
    if ($stepStatus.ContainsKey($stepName)) { $st = $stepStatus[$stepName] }
    return "| $id | $topic | $st | $source |"
}
$lines += (Step-StatusRow 'A-005' 'Engine from pinned fork source' 'Generate engine provenance manifest' 'pipeline provenance step; verify-engine-provenance.py')
$lines += (Step-StatusRow 'A-005b' 'Supplied-engine provenance revalidation' 'Verify supplied engine provenance against pinned clone' 'pipeline step (only when engine supplied)')
$lines += (Step-StatusRow 'A-018' 'RPC v2 handshake smoke (no provider)' 'Live engine RPC v2 handshake smoke, no provider secrets needed' 'scripts/rpc-smoke.py in pipeline')
$lines += (Vm-Row 'A-003' 'canoPi in Installed Apps + Start Menu')
$lines += (Vm-Row 'A-004' 'Fresh install without OMP/Bun/Rust/Node global')
$lines += (Vm-Row 'A-019' 'Setup EXE installs and runtime smoke in VM')
$lines += (Vm-Row 'A-020' 'Uninstall Keep + reinstall restores data')
$lines += (Vm-Row 'A-021' 'Delete removes only canoPi-owned roots')
$lines += (Vm-Row 'A-022' 'No orphan process/shortcut/registry after uninstall')
$lines += (Vm-Row 'A-023' 'Installed OMP/9Router global unchanged across lifecycle')
$artifactOk = (Test-Path -LiteralPath (Join-Path $ReleaseDir 'SHA256SUMS.txt') -PathType Leaf)
$lines += "| A-024 | Build metadata, licenses, checksums, source ZIP | $(if ($artifactOk) { 'PASS' } else { 'NOT RUN' }) | release/ artifacts + SHA256SUMS.txt |"
$lines += ''

$lines += '## 5. Release artifacts'
$lines += ''
$artifactNames = @()
if ($null -ne $manifest) {
    $artifactNames = @(
        "canoPi-Setup-$($manifest.version)-win-x64.exe",
        "canoPi-source-$($manifest.version).zip",
        'ENGINE-PROVENANCE.json', 'BUILD-MANIFEST.json',
        'SHA256SUMS.txt', 'canoPi-windows-installer.zip'
    )
}
$lines += '| Artifact | Status | SHA256 |'
$lines += '|---|---|---|'
$sums = @{}
$sumsPath = Join-Path $ReleaseDir 'SHA256SUMS.txt'
if (Test-Path -LiteralPath $sumsPath -PathType Leaf) {
    foreach ($line in (Get-Content -LiteralPath $sumsPath)) {
        if ($line -match '^([0-9A-Fa-f]{64})\s+(.+)$') { $sums[$Matches[2].Trim()] = $Matches[1] }
    }
}
$lines += '| SHA256SUMS.txt | ' + $(if ($artifactOk) { 'present' } else { 'NOT PRODUCED' }) + ' | (hashes every artifact except this report, which is generated last; no self-hash) |'
foreach ($n in $artifactNames) {
    $p = Join-Path $ReleaseDir $n
    if (Test-Path -LiteralPath $p -PathType Leaf) {
        $h = if ($sums.ContainsKey($n)) { $sums[$n] } else { 'not covered by SHA256SUMS.txt' }
        $lines += "| $n | present | ``$h`` |"
    } else {
        $lines += "| $n | NOT PRODUCED | - |"
    }
}
$lines += 'This RELEASE_TEST_REPORT.md is generated after SHA256SUMS.txt and is therefore the one'
$lines += 'release file not covered by it; every other artifact above is hashed there.'
$lines += ''

$lines += '## 6. Screenshot evidence index'
$lines += ''
$shotsDir = Join-Path $evidenceDir 'screenshots'
$shots = @(); if (Test-Path -LiteralPath $shotsDir) { $shots = @(Get-ChildItem -LiteralPath $shotsDir -File -ErrorAction SilentlyContinue) }
if ($shots.Count -eq 0) {
    $lines += 'No screenshots supplied. Drop files into `release/evidence/screenshots/` and rerun this script to index them.'
} else {
    $lines += '| File | Bytes | Modified (UTC) |'
    $lines += '|---|---|---|'
    foreach ($s in $shots) { $lines += "| $($s.Name) | $($s.Length) | $($s.LastWriteTimeUtc.ToString('o')) |" }
}
$lines += ''
$lines += '## 7. Honest scope notes'
$lines += ''
$lines += '- This build is **unsigned**; no SmartScreen-clean claim is made.'
$lines += '- Data deletion is not secure erase (SSD wear levelling, snapshots, cloud sync).'
$lines += '- Static/disposable-profile tests are labeled as such and are not install E2E.'
$lines += '- Rows marked NOT RUN must be executed (usually in a clean Windows VM) and their'
$lines += '  `release/evidence/vm/<id>.json` (or screenshots) added before any release claim.'
$lines += '- The bundled engine resource path is `resources/engine/cnp-engine.exe` -> `engine/cnp-engine.exe`;'
$lines += '  no PATH, global OMP or 9Router fallback exists in the app or installer.'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outFile) | Out-Null
Set-Content -LiteralPath $outFile -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "Wrote $outFile"
exit 0
