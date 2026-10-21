# Intentionally runs the exact cleanup script against disposable simulated
# Windows profile locations; never touches the runner's actual user data.
# Cases: WU02 owned-root delete, external project + global OMP + 9Router
# preservation, WU04 unowned root refusal, owner-marker mismatch refusal,
# WU09 junction/reparse refusal (all-or-nothing preflight), receipt honesty.
# Every invocation of the cleanup script is a CHILD powershell process so its
# `exit` codes are observed reliably instead of terminating this harness.
$ErrorActionPreference = 'Stop'
$script:Failures = 0
$script:Skips = 0
function Check([bool]$cond, [string]$what) {
    if ($cond) { Write-Host "PASS: $what" }
    else { $script:Failures++; Write-Host "FAIL: $what" -ForegroundColor Red }
}
$cleanup = Join-Path $PSScriptRoot '..\src-tauri\windows\uninstall-data.ps1'
$psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell.exe' }
function Invoke-Cleanup {
    # Child process: its exit code is authoritative. Start-Process inherits the
    # console, so expected refusal messages on stderr are not converted into
    # terminating errors by $ErrorActionPreference = 'Stop' (2>&1 would be).
    $p = Start-Process -FilePath $psExe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $cleanup)) -NoNewWindow -Wait -PassThru
    return $p.ExitCode
}
$base = Join-Path $env:TEMP ('cnp-clean-test-' + [guid]::NewGuid().ToString('N'))
$oldA = $env:APPDATA; $oldL = $env:LOCALAPPDATA; $oldU = $env:USERPROFILE
try {
    foreach ($name in @('roaming','local','home','external')) { New-Item -Force -ItemType Directory -Path (Join-Path $base $name) | Out-Null }
    $env:APPDATA = Join-Path $base 'roaming'
    $env:LOCALAPPDATA = Join-Path $base 'local'
    $env:USERPROFILE = Join-Path $base 'home'

    # External user data that uninstall must NEVER touch: project, global OMP,
    # 9Router global settings.
    $external = Join-Path $base 'external\project\protect.txt'
    New-Item -Force -ItemType Directory -Path (Split-Path $external) | Out-Null
    Set-Content -LiteralPath $external -Value 'MUST_STAY'
    $ompGlobal = Join-Path $env:USERPROFILE '.omp\settings.json'
    New-Item -Force -ItemType Directory -Path (Split-Path $ompGlobal) | Out-Null
    Set-Content -LiteralPath $ompGlobal -Value 'OMP_GLOBAL_STAY'
    $nineRouter = Join-Path $env:APPDATA '9Router\settings.json'
    New-Item -Force -ItemType Directory -Path (Split-Path $nineRouter) | Out-Null
    Set-Content -LiteralPath $nineRouter -Value 'NINEROUTER_STAY'

    $roots = @((Join-Path $env:APPDATA 'app.canopi.desktop'), (Join-Path $env:LOCALAPPDATA 'app.canopi.desktop'), (Join-Path $env:USERPROFILE '.canopi'))
    function Get-Baseline {
        $files = @($external, $ompGlobal, $nineRouter) + @(Get-ChildItem -Path (Join-Path $base 'external') -Recurse -File | ForEach-Object FullName)
        $lines = foreach ($f in $files) { '{0}|{1}' -f (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash, $f }
        return ($lines | Sort-Object) -join "`n"
    }
    $before = Get-Baseline

    # Case 1 (WU02): owned roots with marker are deleted.
    foreach ($root in $roots) {
        New-Item -Force -ItemType Directory -Path $root | Out-Null
        Set-Content -LiteralPath (Join-Path $root '.canopi-owner') -Value 'app.canopi.desktop'
        Set-Content -LiteralPath (Join-Path $root 'example-session.txt') -Value 'dummy'
    }
    $code = Invoke-Cleanup
    Check ($code -eq 0) "owned roots cleanup exits 0 (got $code)"
    foreach ($root in $roots) { Check (-not (Test-Path $root)) "owned root removed: $root" }
    Check ((Get-Baseline) -eq $before) 'external project, global OMP and 9Router settings are byte-identical after Delete'

    # Receipt: honest result, canoPi roots only.
    $receiptPath = Join-Path $env:LOCALAPPDATA 'canoPi-uninstall-receipt.json'
    Check (Test-Path -LiteralPath $receiptPath -PathType Leaf) 'uninstall receipt written'
    if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        Check ($receipt.result -eq 'deleted') "receipt result is 'deleted' (got '$($receipt.result)')"
        Check (@($receipt.deletedRoots).Count -eq 3) 'receipt lists exactly the three canoPi roots'
        Check (($receipt | ConvertTo-Json -Depth 4) -notmatch 'MUST_STAY|OMP_GLOBAL_STAY|NINEROUTER_STAY') 'receipt contains no user file contents'
    }

    # Case 2 (WU04): unowned root is refused, nothing deleted.
    $unowned = $roots[0]
    New-Item -Force -ItemType Directory -Path $unowned | Out-Null
    Set-Content -LiteralPath (Join-Path $unowned 'other-app.txt') -Value 'DO NOT DELETE'
    $code = Invoke-Cleanup
    Check ($code -ne 0) "unowned root refused with nonzero exit (got $code)"
    Check (Test-Path (Join-Path $unowned 'other-app.txt')) 'unowned data survives'

    # Case 3: owner marker mismatch is refused, nothing deleted.
    Set-Content -LiteralPath (Join-Path $unowned '.canopi-owner') -Value 'some.other.app'
    $code = Invoke-Cleanup
    Check ($code -ne 0) "owner marker mismatch refused (got $code)"
    Check (Test-Path (Join-Path $unowned 'other-app.txt')) 'mismatched-marker data survives'
    Remove-Item -LiteralPath $unowned -Recurse -Force

    # Case 4 (WU09): junction inside an owned root must abort preflight.
    $jRoot = $roots[0]
    $outside = Join-Path $base 'outside-target'
    New-Item -Force -ItemType Directory -Path $outside | Out-Null
    Set-Content -LiteralPath (Join-Path $outside 'victim.txt') -Value 'EXTERNAL_MUST_STAY'
    foreach ($root in $roots) {
        New-Item -Force -ItemType Directory -Path $root | Out-Null
        Set-Content -LiteralPath (Join-Path $root '.canopi-owner') -Value 'app.canopi.desktop'
        Set-Content -LiteralPath (Join-Path $root 'session.txt') -Value 'dummy'
    }
    $junctionCreated = $false
    try {
        New-Item -ItemType Junction -Path (Join-Path $jRoot 'escape') -Target $outside -ErrorAction Stop | Out-Null
        $junctionCreated = $true
    } catch {
        $null = cmd /c mklink /J (Join-Path $jRoot 'escape') $outside 2>$null
        $junctionCreated = Test-Path (Join-Path $jRoot 'escape')
    }
    if ($junctionCreated) {
        $code = Invoke-Cleanup
        Check ($code -ne 0) "junction in owned root refused with nonzero exit (got $code)"
        Check (Test-Path (Join-Path $outside 'victim.txt')) 'junction target survives refusal'
        Check (Test-Path (Join-Path $jRoot 'session.txt')) 'refusal is all-or-nothing: owned data still present'
    } else {
        $script:Skips++
        Write-Host 'SKIP: junction creation not permitted on this system; WU09 reparse case NOT RUN here (still required in VM matrix)'
    }

    if ($script:Failures -eq 0) {
        Write-Host "PASS: deletes marked canoPi roots, never deletes external or unowned paths ($($script:Skips) skip)"
        exit 0
    } else {
        Write-Host "FAIL: $script:Failures check(s) failed" -ForegroundColor Red
        exit 1
    }
} finally {
    $env:APPDATA=$oldA; $env:LOCALAPPDATA=$oldL; $env:USERPROFILE=$oldU
    Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
