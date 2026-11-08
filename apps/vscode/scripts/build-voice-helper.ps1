#!/usr/bin/env powershell
<#
.SYNOPSIS
  Builds the Bytos Voice Windows x64 WASAPI capture helper.

.DESCRIPTION
  Compiles native/voice-helper-windows/bv-os-audio-helper.cpp into
  assets/voice/bin/win32-x64/bv-os-audio-helper.exe and prints the artifact's
  SHA-256 (recorded in assets/voice/README.md).

  Requires the Microsoft C++ toolchain (Visual Studio 2022 Build Tools or
  higher, "Desktop development with C++" workload) and the Windows 10/11 SDK.
  Uses vswhere when present, falls back to the well-known Build Tools location.

.PARAMETER Configuration
  Release (default) or Debug.

.PARAMETER Clean
  Remove the intermediate object directory before building.
#>
param(
    [ValidateSet("Release", "Debug")]
    [string]$Configuration = "Release",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "native\voice-helper-windows\bv-os-audio-helper.cpp"
$outDir = Join-Path $root "assets\voice\bin\win32-x64"
$objDir = Join-Path $root "native\voice-helper-windows\obj"
$target = Join-Path $outDir "bv-os-audio-helper.exe"

if (-not (Test-Path -LiteralPath $source)) {
    throw "Helper source not found: $source"
}

if ($Clean -and (Test-Path -LiteralPath $objDir)) {
    Remove-Item -LiteralPath $objDir -Recurse -Force
}

function Resolve-VcVarsAll {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $vswhere) {
        $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($install) {
            $candidate = Join-Path $install.Trim() "VC\Auxiliary\Build\vcvars64.bat"
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
    }
    $fallbacks = @(
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    )
    foreach ($candidate in $fallbacks) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

$vcvars = Resolve-VcVarsAll
if (-not $vcvars) {
    throw @"
Could not find vcvars64.bat. Install the Visual Studio 2022 (or newer) C++ build
tools with the "Desktop development with C++" workload, then re-run this script.
"@
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
New-Item -ItemType Directory -Force -Path $objDir | Out-Null

$optFlags = if ($Configuration -eq "Release") { "/O2 /DNDEBUG" } else { "/Od /Zi" }

# /utf-8      — source and execution character sets are UTF-8 (device names)
# ole32/uuid  — COM (MMDevice) and KSDATAFORMAT_* GUIDs
# avrt        — linked for completeness; the helper does not call into it
$clCommand = @"
call "$vcvars" >NUL && cl /nologo /EHsc /W4 /utf-8 /std:c++17 $optFlags /Fo"$objDir\\" /Fd"$objDir\helper.pdb" /Fe"$target" "$source" ole32.lib uuid.lib
"@

Write-Host "Building bv-os-audio-helper.exe ($Configuration)…"
cmd.exe /c $clCommand
if ($LASTEXITCODE -ne 0) {
    throw "Helper build failed with exit code $LASTEXITCODE"
}

$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $target).Length
Write-Host ""
Write-Host "Artifact : $target"
Write-Host "Size     : $size bytes"
Write-Host "SHA-256  : $hash"
