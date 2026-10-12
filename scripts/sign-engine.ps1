<#
.SYNOPSIS
    Sign a Windows PE binary with Authenticode using the certificate from the current user store.

.DESCRIPTION
    Uses signtool.exe to sign a binary. Requires certificate to be present in Cert:\CurrentUser\My
    with matching thumbprint. Supports RFC3161 timestamp.

.PARAMETER BinaryPath
    Path to the binary to sign (must be .exe or .dll)

.PARAMETER Thumbprint
    SHA-1 thumbprint of the certificate (uppercase, no spaces)

.PARAMETER TimestampUrl
    RFC3161 timestamp server URL (default: http://timestamp.sectigo.com)

.PARAMETER DigestAlgorithm
    Digest algorithm (default: sha256)

.PARAMETER Description
    Description to embed in signature (default: canoPi)

.PARAMETER Subject
    Expected certificate subject DN for verification

.EXAMPLE
    powershell -File scripts\sign-engine.ps1 -BinaryPath .\cnp-engine.exe -Thumbprint "A1B2C3..." -Subject "CN=canoPi Project, O=Org, C=US"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$BinaryPath,

    [Parameter(Mandatory=$true)]
    [string]$Thumbprint,

    [Parameter(Mandatory=$true)]
    [string]$Subject,

    [string]$TimestampUrl = 'http://timestamp.sectigo.com',

    [string]$DigestAlgorithm = 'sha256',

    [string]$Description = 'canoPi'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $BinaryPath -PathType Leaf)) {
    throw "Binary not found: $BinaryPath"
}

# Find signtool
$signtoolPath = $null
$env:TAURI_WINDOWS_SIGNTOOL_PATH | ForEach-Object { if (Test-Path $_) { $signtoolPath = $_ } }
if (-not $signtoolPath) {
    $installedRoots = 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots'
    if (Test-Path $installedRoots) {
        $kitsRoot = Get-ItemProperty $installedRoots -Name 'KitsRoot10' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty KitsRoot10
        if ($kitsRoot) {
            $binPaths = @()
            $installedRootsKey = Get-Item $installedRoots
            $installedRootsKey.GetSubKeyNames() | Sort-Object | ForEach-Object {
                $binPaths += Join-Path (Join-Path $kitsRoot 'bin') $_
            }
            $binPaths += Join-Path $kitsRoot 'bin'
            $archDir = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
            foreach ($bp in $binPaths) {
                $candidate = Join-Path (Join-Path $bp $archDir) 'signtool.exe'
                if (Test-Path $candidate) { $signtoolPath = $candidate; break }
            }
        }
    }
}
if (-not $signtoolPath) { throw 'signtool.exe not found. Install Windows SDK.' }

# Verify cert exists in store
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint.ToUpper() -eq $Thumbprint.ToUpper() }
if (-not $cert) { throw "Certificate with thumbprint $Thumbprint not found in CurrentUser\My" }
if ($cert.Subject -ne $Subject) { throw "Certificate subject mismatch: found '$($cert.Subject)', expected '$Subject'" }

Write-Host "Signing $BinaryPath with cert $Thumbprint" -ForegroundColor Cyan

$signResult = & $signtoolPath sign `
    /fd $DigestAlgorithm `
    /sha1 $Thumbprint `
    /d $Description `
    /tr $TimestampUrl `
    /td $DigestAlgorithm `
    $BinaryPath

if ($LASTEXITCODE -ne 0) {
    throw "signtool failed with exit code ${LASTEXITCODE}: $signResult"
}

# Verify signature
$sig = Get-AuthenticodeSignature -FilePath $BinaryPath
if ($sig.Status -ne 'Valid') { throw "Signature verification failed: $($sig.Status)" }
if ($sig.SignerCertificate.Thumbprint.ToUpper() -ne $Thumbprint.ToUpper()) { throw "Thumbprint mismatch after signing" }
if ($sig.SignerCertificate.Subject -ne $Subject) { throw "Subject mismatch after signing" }

# Verify timestamp certificate (RFC3161)
if (-not $sig.TimeStamperCertificate) {
    throw "Timestamp certificate missing; RFC3161 timestamp not properly embedded"
}

Write-Host "Signed and verified: $BinaryPath" -ForegroundColor Green
exit 0