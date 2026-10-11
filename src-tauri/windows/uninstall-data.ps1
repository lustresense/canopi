# Only invoked after explicit NSIS choice "Delete canoPi data".
# Do not accept any caller-provided arbitrary paths. Reject reparse points.
$ErrorActionPreference = 'Stop'
$AppId = 'app.canopi.desktop'
$roots = @(
    (Join-Path $env:LOCALAPPDATA $AppId),
    (Join-Path $env:APPDATA $AppId),
    (Join-Path $env:USERPROFILE '.canopi')
)
$markerFile = '.canopi-owner'

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
    foreach ($root in $roots) {
        if (Test-Path -LiteralPath $root -PathType Container) { Remove-Tree $root }
    }
    exit 0
} catch {
    # Do not echo contents of user-owned files or credentials.
    Write-Error "Cleanup cancelled or incomplete because an ownership/safety check failed."
    exit 2
}
