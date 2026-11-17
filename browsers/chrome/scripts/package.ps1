#requires -Version 5.1
<#
.SYNOPSIS
    Validates Chrome theme and/or companion extension manifests & assets and builds distributable packages.
#>
[CmdletBinding()]
param(
    [string]$ChromeRoot,
    [string]$RepoRoot,
    [ValidateSet('All', 'Theme', 'Extension')]
    [string]$Target = 'All',
    [switch]$CreateZip = $true,
    [switch]$Release
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ([string]::IsNullOrWhiteSpace($ChromeRoot)) {
    $ChromeRoot = Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $ChromeRoot)
}

function Find-ChromeExecutable {
    $candidates = @(
        'C:\Program Files\Google\Chrome\Application\chrome.exe',
        'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate -PathType Leaf)) {
            return $candidate
        }
    }
    $cmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'Google Chrome executable (chrome.exe) not found for CRX packaging.'
}

function Build-CrxPackage {
    param(
        [Parameter(Mandatory)][string]$StageDir,
        [Parameter(Mandatory)][string]$CrxOutPath,
        [Parameter(Mandatory)][string]$PemKeyPath
    )

    $chromeExe = Find-ChromeExecutable
    $keyDir = Split-Path -Parent $PemKeyPath
    if (-not (Test-Path $keyDir)) {
        New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
    }

    $stageParent = Split-Path -Parent $StageDir
    $stageLeaf = Split-Path -Leaf $StageDir
    $generatedCrx = Join-Path $stageParent "$stageLeaf.crx"
    $generatedPem = Join-Path $stageParent "$stageLeaf.pem"
    if (Test-Path $generatedCrx) { Remove-Item $generatedCrx -Force }
    if (Test-Path $generatedPem) { Remove-Item $generatedPem -Force }

    $argList = @("--pack-extension=$StageDir")
    if (Test-Path $PemKeyPath -PathType Leaf) {
        $argList += "--pack-extension-key=$PemKeyPath"
    }

    $proc = Start-Process -FilePath $chromeExe -ArgumentList $argList -Wait -PassThru
    if ($proc.ExitCode -ne 0 -or -not (Test-Path $generatedCrx -PathType Leaf)) {
        throw "Chrome --pack-extension failed (exit code $($proc.ExitCode)) for $StageDir"
    }

    if (Test-Path $CrxOutPath) { Remove-Item $CrxOutPath -Force }
    Move-Item -Path $generatedCrx -Destination $CrxOutPath -Force

    if ((Test-Path $generatedPem -PathType Leaf) -and -not (Test-Path $PemKeyPath -PathType Leaf)) {
        Move-Item -Path $generatedPem -Destination $PemKeyPath -Force
    } elseif (Test-Path $generatedPem -PathType Leaf) {
        Remove-Item $generatedPem -Force
    }

    # Verify CRX3 magic bytes ("Cr24", version = 3)
    $head = [System.IO.File]::ReadAllBytes($CrxOutPath)
    if ($head.Length -lt 12 -or $head[0] -ne 0x43 -or $head[1] -ne 0x72 -or $head[2] -ne 0x32 -or $head[3] -ne 0x34) {
        throw "Invalid CRX header in generated file: $CrxOutPath"
    }
    $crxVersion = [BitConverter]::ToUInt32($head, 4)
    if ($crxVersion -ne 3) {
        throw "Expected CRX3 (version 3), got CRX version $crxVersion"
    }
}

function Test-PackageLocales {
    param(
        [Parameter(Mandatory)][string]$RootDir,
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)][string]$Kind
    )

    $localesDir    = Join-Path $RootDir '_locales'
    $hasLocalesDir = Test-Path $localesDir -PathType Container
    $hasDefaultLoc = ($Manifest.PSObject.Properties.Name -contains 'default_locale') -and -not [string]::IsNullOrWhiteSpace([string]$Manifest.default_locale)

    if ($hasLocalesDir -and -not $hasDefaultLoc) {
        throw "$Kind has _locales directory but manifest.json is missing `"default_locale`"."
    }
    if ($hasDefaultLoc -and -not $hasLocalesDir) {
        throw "$Kind manifest declares default_locale '$($Manifest.default_locale)' but _locales directory is missing."
    }
    if (-not $hasLocalesDir) {
        return 0
    }

    $defaultMessages = Join-Path $localesDir "$($Manifest.default_locale)\messages.json"
    if (-not (Test-Path $defaultMessages -PathType Leaf)) {
        throw "Missing default_locale messages file: $defaultMessages"
    }

    $msgKeys = [System.Collections.Generic.List[string]]::new()
    $nameKey = $null
    $descKey = $null
    $candidates = @([string]$Manifest.name, [string]$Manifest.description)
    if ($Manifest.PSObject.Properties.Name -contains 'action' -and $Manifest.action -and ($Manifest.action.PSObject.Properties.Name -contains 'default_title')) {
        $candidates += [string]$Manifest.action.default_title
    }
    if ($Manifest.PSObject.Properties.Name -contains 'commands' -and $Manifest.commands) {
        foreach ($cmdProp in $Manifest.commands.PSObject.Properties) {
            if ($cmdProp.Value -and ($cmdProp.Value.PSObject.Properties.Name -contains 'description')) {
                $candidates += [string]$cmdProp.Value.description
            }
        }
    }

    foreach ($fieldVal in $candidates) {
        if ($fieldVal -match '^__MSG_([A-Za-z0-9_@]+)__$') {
            $k = $Matches[1]
            if (-not $msgKeys.Contains($k)) { $msgKeys.Add($k) }
        }
    }
    if ([string]$Manifest.name -match '^__MSG_([A-Za-z0-9_@]+)__$') { $nameKey = $Matches[1] }
    if ([string]$Manifest.description -match '^__MSG_([A-Za-z0-9_@]+)__$') { $descKey = $Matches[1] }

    $localeDirs = @(Get-ChildItem -Path $localesDir -Directory)
    if ($localeDirs.Count -eq 0) {
        throw "$Kind _locales directory contains no locale subdirectories."
    }

    foreach ($locDir in $localeDirs) {
        $msgPath = Join-Path $locDir.FullName 'messages.json'
        if (-not (Test-Path $msgPath -PathType Leaf)) {
            throw "Missing messages.json in $Kind locale '$($locDir.Name)'."
        }
        $msgs = Get-Content -Raw -Encoding UTF8 $msgPath | ConvertFrom-Json
        foreach ($key in $msgKeys) {
            if (-not ($msgs.PSObject.Properties.Name -contains $key)) {
                throw "$Kind locale '$($locDir.Name)' is missing manifest message key '$key'."
            }
            $val = [string]$msgs.$key.message
            if ([string]::IsNullOrWhiteSpace($val)) {
                throw "$Kind locale '$($locDir.Name)' has empty message for '$key'."
            }
            if ($key -eq $nameKey -and $val.Length -gt 75) {
                throw "$Kind locale '$($locDir.Name)' $key exceeds 75 characters ($($val.Length))."
            }
            if ($key -eq $descKey -and $val.Length -gt 132) {
                throw "$Kind locale '$($locDir.Name)' $key exceeds 132 characters ($($val.Length))."
            }
        }
    }

    return $localeDirs.Count
}

function Copy-PackageLocales {
    param(
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$StageDir
    )

    $localesDir = Join-Path $SourceRoot '_locales'
    if (-not (Test-Path $localesDir -PathType Container)) {
        return $false
    }

    $dstLocales = Join-Path $StageDir '_locales'
    foreach ($locDir in (Get-ChildItem -Path $localesDir -Directory)) {
        $dstLocDir = Join-Path $dstLocales $locDir.Name
        New-Item -ItemType Directory -Force -Path $dstLocDir | Out-Null
        Copy-Item -Path (Join-Path $locDir.FullName 'messages.json') -Destination (Join-Path $dstLocDir 'messages.json') -Force
    }
    return $true
}

$distDir = Join-Path $RepoRoot 'dist\chrome'
$buildTheme = ($Target -eq 'All' -or $Target -eq 'Theme')
$buildExtension = ($Target -eq 'All' -or $Target -eq 'Extension')

if ($buildTheme) {
    $themeDir     = Join-Path $ChromeRoot 'theme'
    $manifestPath = Join-Path $themeDir 'manifest.json'
    if (-not (Test-Path $manifestPath)) {
        throw "Manifest not found: $manifestPath"
    }

    $manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
    if ($manifest.manifest_version -ne 3) {
        throw "Expected manifest_version 3, got $($manifest.manifest_version)"
    }
    if (-not $manifest.theme) {
        throw 'Theme manifest missing required "theme" block.'
    }
    foreach ($forbidden in @('permissions', 'content_scripts', 'background', 'chrome_url_overrides')) {
        if ($manifest.PSObject.Properties.Name -contains $forbidden) {
            throw "Theme manifest must not declare extension key '$forbidden'."
        }
    }

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

    $localeCount = Test-PackageLocales -RootDir $themeDir -Manifest $manifest -Kind 'Theme'

    $colorCount = @($manifest.theme.colors.PSObject.Properties).Count
    $tintCount  = @($manifest.theme.tints.PSObject.Properties).Count
    Write-Host "Validated $($imagePaths.Count) PNG assets, $colorCount colors, $tintCount tints, and $localeCount locales."

    if ($CreateZip -or $Release) {
        if (-not (Test-Path $distDir)) {
            New-Item -ItemType Directory -Force -Path $distDir | Out-Null
        }

        # Stage only declared manifest + PNGs + _locales (never Cached Theme.pak or extraneous files)
        $stageBase = Join-Path ([System.IO.Path]::GetTempPath()) ("nh-theme-stage-" + [Guid]::NewGuid().ToString('N'))
        $stageDir  = Join-Path $stageBase 'theme'
        New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

        try {
            Copy-Item -Path $manifestPath -Destination (Join-Path $stageDir 'manifest.json') -Force
            foreach ($relPath in ($imagePaths | Select-Object -Unique)) {
                $srcImg = Join-Path $themeDir $relPath
                $dstImg = Join-Path $stageDir $relPath
                $dstParent = Split-Path -Parent $dstImg
                if (-not (Test-Path $dstParent)) {
                    New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
                }
                Copy-Item -Path $srcImg -Destination $dstImg -Force
            }

            $archiveItems = @('manifest.json', 'images')
            if (Copy-PackageLocales -SourceRoot $themeDir -StageDir $stageDir) {
                $archiveItems += '_locales'
            }

            if ($CreateZip) {
                $zipPath = Join-Path $distDir 'neon-horizon-synthwave-theme.zip'
                if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
                Push-Location $stageDir
                try {
                    Compress-Archive -Path $archiveItems -DestinationPath $zipPath -CompressionLevel Optimal
                } finally {
                    Pop-Location
                }
                Write-Host "Packaged theme ZIP archive: $zipPath"
            }

            if ($Release) {
                $version = [string]$manifest.version
                $relDir  = Join-Path $distDir "releases\theme-v$version"
                if (Test-Path $relDir) { Remove-Item $relDir -Recurse -Force }
                New-Item -ItemType Directory -Force -Path $relDir | Out-Null

                $relZipName = "neon-horizon-synthwave-theme-v$version.zip"
                $relCrxName = "neon-horizon-synthwave-theme-v$version.crx"
                $relZipPath = Join-Path $relDir $relZipName
                $relCrxPath = Join-Path $relDir $relCrxName
                $pemKeyPath = Join-Path $distDir 'keys\neon-horizon-synthwave-theme.pem'

                Push-Location $stageDir
                try {
                    Compress-Archive -Path $archiveItems -DestinationPath $relZipPath -CompressionLevel Optimal
                } finally {
                    Pop-Location
                }

                Build-CrxPackage -StageDir $stageDir -CrxOutPath $relCrxPath -PemKeyPath $pemKeyPath

                $sumLines = @(
                    "$((Get-FileHash -Algorithm SHA256 $relZipPath).Hash.ToLowerInvariant())  $relZipName",
                    "$((Get-FileHash -Algorithm SHA256 $relCrxPath).Hash.ToLowerInvariant())  $relCrxName"
                )
                $sumPath = Join-Path $relDir 'SHA256SUMS.txt'
                [System.IO.File]::WriteAllLines($sumPath, $sumLines, (New-Object System.Text.UTF8Encoding($false)))

                Write-Host "Theme v$version release ready in: $relDir"
                Write-Host "  ZIP: $relZipPath"
                Write-Host "  CRX: $relCrxPath"
                Write-Host "  PEM key (private, keep safe outside release): $pemKeyPath"
            }
        } finally {
            if (Test-Path $stageBase) {
                Remove-Item -LiteralPath $stageBase -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

if ($buildExtension) {
    $extDir          = Join-Path $ChromeRoot 'extension'
    $extManifestPath = Join-Path $extDir 'manifest.json'
    if (Test-Path $extManifestPath) {
        $extManifest = Get-Content -Raw -Encoding UTF8 $extManifestPath | ConvertFrom-Json
        if ($extManifest.manifest_version -ne 3) {
            throw "Expected extension manifest_version 3, got $($extManifest.manifest_version)"
        }
        $extRequired = @(
            'manifest.json',
            'background.js',
            'content.js',
            'popup.html',
            'popup.css',
            'popup.js',
            'newtab.html',
            'newtab.css',
            'newtab.js',
            'shared\defaults.js',
            'shared\i18n.js',
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
        $extLocaleCount = Test-PackageLocales -RootDir $extDir -Manifest $extManifest -Kind 'Extension'
        Write-Host "Validated companion CRT/VHS shader extension ($($extRequired.Count) files, $extLocaleCount locales)."

        if ($CreateZip -or $Release) {
            if (-not (Test-Path $distDir)) {
                New-Item -ItemType Directory -Force -Path $distDir | Out-Null
            }

            $stageBase = Join-Path ([System.IO.Path]::GetTempPath()) ("nh-ext-stage-" + [Guid]::NewGuid().ToString('N'))
            $stageDir  = Join-Path $stageBase 'extension'
            New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

            try {
                foreach ($rel in $extRequired) {
                    $srcFile = Join-Path $extDir $rel
                    $dstFile = Join-Path $stageDir $rel
                    $dstParent = Split-Path -Parent $dstFile
                    if (-not (Test-Path $dstParent)) {
                        New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
                    }
                    Copy-Item -Path $srcFile -Destination $dstFile -Force
                }
                Copy-PackageLocales -SourceRoot $extDir -StageDir $stageDir | Out-Null

                if ($CreateZip) {
                    $extZipPath = Join-Path $distDir 'neon-horizon-crt-vhs-shader.zip'
                    if (Test-Path $extZipPath) { Remove-Item $extZipPath -Force }
                    Push-Location $stageDir
                    try {
                        Compress-Archive -Path @('*') -DestinationPath $extZipPath -CompressionLevel Optimal
                    } finally {
                        Pop-Location
                    }
                    Write-Host "Packaged extension ZIP archive: $extZipPath"
                }

                if ($Release) {
                    $extVersion = [string]$extManifest.version
                    $relDir     = Join-Path $distDir "releases\extension-v$extVersion"
                    if (Test-Path $relDir) { Remove-Item $relDir -Recurse -Force }
                    New-Item -ItemType Directory -Force -Path $relDir | Out-Null

                    $relZipName = "neon-horizon-crt-vhs-shader-v$extVersion.zip"
                    $relCrxName = "neon-horizon-crt-vhs-shader-v$extVersion.crx"
                    $relZipPath = Join-Path $relDir $relZipName
                    $relCrxPath = Join-Path $relDir $relCrxName
                    $pemKeyPath = Join-Path $distDir 'keys\neon-horizon-crt-vhs-shader.pem'

                    Push-Location $stageDir
                    try {
                        Compress-Archive -Path @('*') -DestinationPath $relZipPath -CompressionLevel Optimal
                    } finally {
                        Pop-Location
                    }

                    Build-CrxPackage -StageDir $stageDir -CrxOutPath $relCrxPath -PemKeyPath $pemKeyPath

                    $sumLines = @(
                        "$((Get-FileHash -Algorithm SHA256 $relZipPath).Hash.ToLowerInvariant())  $relZipName",
                        "$((Get-FileHash -Algorithm SHA256 $relCrxPath).Hash.ToLowerInvariant())  $relCrxName"
                    )
                    $sumPath = Join-Path $relDir 'SHA256SUMS.txt'
                    [System.IO.File]::WriteAllLines($sumPath, $sumLines, (New-Object System.Text.UTF8Encoding($false)))

                    Write-Host "Extension v$extVersion release ready in: $relDir"
                    Write-Host "  ZIP: $relZipPath"
                    Write-Host "  CRX: $relCrxPath"
                    Write-Host "  PEM key (private, keep safe outside release): $pemKeyPath"
                }
            } finally {
                if (Test-Path $stageBase) {
                    Remove-Item -LiteralPath $stageBase -Recurse -Force -ErrorAction SilentlyContinue
                }
            }
        }
    }
}
