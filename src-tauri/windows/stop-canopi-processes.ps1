# Stop canoPi processes that live inside THIS installation only.
# Called from NSIS NSIS_HOOK_PREUNINSTALL before file removal.
# Scope guard: an executable is only touched when its full image path is
# directly under -InstallDir (prefix + separator, case-insensitive). A global
# OMP engine, 9Router binaries, or any foreign process are never touched.
# Bounded graceful wait, then forced termination; honest exit codes:
#   0 = nothing running or all stopped, 3 = at least one process survived.
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [int]$GraceSeconds = 10
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
    if ([string]::IsNullOrWhiteSpace($InstallDir)) { throw 'InstallDir is empty' }
    $dir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
    $names = @('canoPi.exe', 'cnp-engine.exe')
    $targets = @()
    foreach ($proc in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        if ($proc.Name -notin $names) { continue }
        $img = $proc.ExecutablePath
        if ([string]::IsNullOrWhiteSpace($img)) { continue }
        $imgFull = [IO.Path]::GetFullPath($img)
        if (-not $imgFull.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $targets += [pscustomobject]@{ Id = $proc.ProcessId; Name = $proc.Name }
    }
    if ($targets.Count -eq 0) { exit 0 }

    # Graceful phase: request close on the GUI, wait bounded.
    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(0, $GraceSeconds))
    foreach ($t in $targets) {
        try {
            $p = Get-Process -Id $t.Id -ErrorAction Stop
            if ($t.Name -eq 'canoPi.exe') { $null = $p.CloseMainWindow() } catch { }
        } catch { }
    }
    while ([DateTime]::UtcNow -lt $deadline) {
        $alive = @()
        foreach ($t in $targets) {
            try { $null = Get-Process -Id $t.Id -ErrorAction Stop; $alive += $t } catch { }
        }
        if ($alive.Count -eq 0) { exit 0 }
        $targets = $alive
        Start-Sleep -Milliseconds 500
    }

    # Forced phase, still inside the install scope captured above.
    foreach ($t in $targets) {
        try { Stop-Process -Id $t.Id -Force -ErrorAction Stop } catch { }
    }
    Start-Sleep -Milliseconds 800
    $survivors = @()
    foreach ($t in $targets) {
        try { $null = Get-Process -Id $t.Id -ErrorAction Stop; $survivors += $t.Name } catch { }
    }
    if ($survivors.Count -gt 0) { exit 3 }
    exit 0
} catch {
    # Do not echo arbitrary paths or process command lines.
    [Console]::Error.WriteLine('canoPi process stop helper failed an internal safety check.')
    exit 4
}
