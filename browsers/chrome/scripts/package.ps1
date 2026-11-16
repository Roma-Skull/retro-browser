#requires -Version 5.1
<#
.SYNOPSIS
    Validates the Chrome theme manifest & assets and builds a distributable ZIP package.
#>
[CmdletBinding()]
param(
    [string]$ChromeRoot,
    [string]$RepoRoot,
    [switch]$CreateZip = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ChromeRoot)) {
    $ChromeRoot = Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $ChromeRoot)
}

$themeDir     = Join-Path $ChromeRoot 'theme'
$manifestPath = Join-Path $themeDir 'manifest.json'

if (-not (Test-Path $manifestPath)) {
    throw "Manifest not found: $manifestPath"
}

$manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json

if ($manifest.manifest_version -ne 3) {
    throw "Expected manifest_version 3, got $($manifest.manifest_version)"
}

# Verify declared icon and theme image files exist
$imagePaths = @()
if ($manifest.icons) {
    foreach ($prop in $manifest.icons.PSObject.Properties) {
        $imagePaths += $prop.Value
    }
}
if ($manifest.theme.images) {
    foreach ($prop in $manifest.theme.images.PSObject.Properties) {
        $imagePaths += $prop.Value
    }
}

foreach ($relPath in $imagePaths) {
    $fullPath = Join-Path $themeDir $relPath
    if (-not (Test-Path $fullPath)) {
        throw "Missing image referenced in manifest.json: $relPath"
    }
    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    if ($bytes.Length -lt 8 -or $bytes[0] -ne 0x89 -or $bytes[1] -ne 0x50 -or $bytes[2] -ne 0x4E -or $bytes[3] -ne 0x47) {
        throw "File is not a valid PNG: $relPath"
    }
}

# Validate RGB [0..255] arrays
foreach ($prop in $manifest.theme.colors.PSObject.Properties) {
    $arr = @($prop.Value)
    if ($arr.Count -ne 3) {
        throw "Color '$($prop.Name)' must have exactly 3 RGB components."
    }
    foreach ($c in $arr) {
        if ($c -lt 0 -or $c -gt 255) {
            throw "Color '$($prop.Name)' component out of [0..255]: $c"
        }
    }
}

# Validate HSL tint [-1..1] arrays
foreach ($prop in $manifest.theme.tints.PSObject.Properties) {
    $arr = @($prop.Value)
    if ($arr.Count -ne 3) {
        throw "Tint '$($prop.Name)' must have exactly 3 HSL components."
    }
    foreach ($v in $arr) {
        if ($v -lt -1.0 -or $v -gt 1.0) {
            throw "Tint '$($prop.Name)' component out of [-1..1]: $v"
        }
    }
}

$colorCount = @($manifest.theme.colors.PSObject.Properties).Count
$tintCount  = @($manifest.theme.tints.PSObject.Properties).Count
Write-Host "Validated $($imagePaths.Count) PNG assets, $colorCount colors, and $tintCount tints."

# Validate companion CRT/VHS shader extension
$extDir          = Join-Path $ChromeRoot 'extension'
$extManifestPath = Join-Path $extDir 'manifest.json'
if (Test-Path $extManifestPath) {
    $extManifest = Get-Content -Raw -Encoding UTF8 $extManifestPath | ConvertFrom-Json
    if ($extManifest.manifest_version -ne 3) {
        throw "Expected extension manifest_version 3, got $($extManifest.manifest_version)"
    }
    $extRequired = @(
        'background.js',
        'content.js',
        'popup.html',
        'popup.css',
        'popup.js',
        'newtab.html',
        'newtab.css',
        'newtab.js',
        'shared\defaults.js',
        'shared\controls.js',
        'assets\ntp_wallpaper.png',
        'icons\icon16.png',
        'icons\icon48.png',
        'icons\icon128.png'
    )
    foreach ($rel in $extRequired) {
        if (-not (Test-Path (Join-Path $extDir $rel))) {
            throw "Missing extension file: $rel"
        }
    }
    Write-Host "Validated companion CRT/VHS shader extension ($($extRequired.Count) core files)."
}

if ($CreateZip) {
    $distDir = Join-Path $RepoRoot 'dist\chrome'
    if (-not (Test-Path $distDir)) {
        New-Item -ItemType Directory -Force -Path $distDir | Out-Null
    }
    $zipPath = Join-Path $distDir 'neon-horizon-synthwave-theme.zip'
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path @(
        (Join-Path $themeDir 'manifest.json'),
        (Join-Path $themeDir 'images')
    ) -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host "Packaged theme ZIP archive: $zipPath"

    if (Test-Path $extManifestPath) {
        $extZipPath = Join-Path $distDir 'neon-horizon-crt-vhs-shader.zip'
        if (Test-Path $extZipPath) { Remove-Item $extZipPath -Force }
        Compress-Archive -Path @(
            (Join-Path $extDir 'manifest.json'),
            (Join-Path $extDir 'background.js'),
            (Join-Path $extDir 'content.js'),
            (Join-Path $extDir 'popup.html'),
            (Join-Path $extDir 'popup.css'),
            (Join-Path $extDir 'popup.js'),
            (Join-Path $extDir 'newtab.html'),
            (Join-Path $extDir 'newtab.css'),
            (Join-Path $extDir 'newtab.js'),
            (Join-Path $extDir 'shared'),
            (Join-Path $extDir 'assets'),
            (Join-Path $extDir 'icons')
        ) -DestinationPath $extZipPath -CompressionLevel Optimal
        Write-Host "Packaged extension ZIP archive: $extZipPath"
    }
}
