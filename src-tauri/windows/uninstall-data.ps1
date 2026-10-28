# Only invoked after explicit NSIS choice "Delete canoPi data".
# Do not accept any caller-provided arbitrary paths. Reject reparse points.
# Deletion is all-or-nothing: every candidate root must pass ownership and
# reparse preflight before a single file is removed. Never touches project
# folders, global OMP (`~/.omp`), 9Router settings, or other applications.
# Writes an honest receipt (categories + canoPi root paths only, no file
# contents, no credentials) to %LOCALAPPDATA%\canoPi-uninstall-receipt.json.
$ErrorActionPreference = 'Stop'
$AppId = 'app.canopi.desktop'
$roots = @(
    (Join-Path $env:LOCALAPPDATA $AppId),
    (Join-Path $env:APPDATA $AppId),
    (Join-Path $env:USERPROFILE '.canopi')
)
$markerFile = '.canopi-owner'
$receiptPath = Join-Path $env:LOCALAPPDATA 'canoPi-uninstall-receipt.json'

function Write-Receipt([string]$result, [string]$category, [string[]]$deleted) {
    $payload = [ordered]@{
        schema      = 'canopi-uninstall-receipt/1'
        result      = $result
        category    = $category
        app         = $AppId
        deletedRoots = @($deleted)
        utc         = [DateTime]::UtcNow.ToString('o')
        note        = 'Paths listed are canoPi-owned data roots only. No file contents, project or credential data recorded.'
    }
    try { $payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $receiptPath -Encoding UTF8 } catch { }
}

function Assert-NoReparse([string]$path) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing reparse point: $path"
    }
}
function Inspect-Tree([string]$path) {
    Assert-NoReparse $path
    foreach ($item in (Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop)) {
        Assert-NoReparse $item.FullName
        if ($item.PSIsContainer) { Inspect-Tree $item.FullName }
    }
}
function Remove-Tree([string]$path) {
    foreach ($item in (Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop)) {
        if ($item.PSIsContainer) { Remove-Tree $item.FullName }
        else { Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop }
    }
    Remove-Item -LiteralPath $path -Force -ErrorAction Stop
}

try {
    # Preflight all roots first. If any is unowned, keep everything.
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        Assert-NoReparse $root
        $marker = Join-Path $root $markerFile
        if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
            throw "Unowned canoPi directory, refusing deletion: $root"
        }
        $id = (Get-Content -LiteralPath $marker -Raw -ErrorAction Stop).Trim()
        if ($id -cne $AppId) { throw "Owner marker mismatch: $root" }
        Inspect-Tree $root
    }
    $deleted = @()
    foreach ($root in $roots) {
        if (Test-Path -LiteralPath $root -PathType Container) {
            Remove-Tree $root
            $deleted += $root
        }
    }
    Write-Receipt 'deleted' 'none' $deleted
    exit 0
} catch {
    # Do not echo contents of user-owned files or credentials.
    $msg = $_.Exception.Message
    $category = 'in-use-or-access-denied'
    if ($msg -like '*reparse point*') { $category = 'reparse-point-refused' }
    elseif ($msg -like '*Unowned*') { $category = 'unowned-root-refused' }
    elseif ($msg -like '*Owner marker mismatch*') { $category = 'owner-marker-mismatch' }
    Write-Receipt 'refused-or-incomplete' $category @()
    [Console]::Error.WriteLine("Cleanup cancelled or incomplete because an ownership/safety check failed (category: $category).")
    exit 2
}
