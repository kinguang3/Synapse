#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Version = '0.1.1',

    [ValidateSet('auto', 'code', 'code-insiders', 'trae-cn', 'trae')]
    [string]$Editor = 'auto',

    [string]$VsixPath,

    [switch]$Force,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Repo = 'kinguang3/Synapse'
$ExtensionId = 'synapse-local.synapse-companion'
$AssetName = "synapse-companion-$Version.vsix"

function Find-EditorCommand {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    if ($env:OS -ne 'Windows_NT' -or $Name -ne 'code') {
        return $null
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'),
        (Join-Path $env:ProgramFiles 'Microsoft VS Code\bin\code.cmd')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }
    return $null
}

function Resolve-Vsix {
    if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$') {
        throw "Invalid version: $Version"
    }

    $localAsset = if ($PSScriptRoot) {
        Join-Path (Split-Path -Parent $PSScriptRoot) "dist\$AssetName"
    } else {
        $null
    }
    if ($VsixPath) {
        $resolved = (Resolve-Path -LiteralPath $VsixPath).Path
        return @{ Path = $resolved; Temporary = $false }
    }
    if ($localAsset -and (Test-Path -LiteralPath $localAsset)) {
        return @{ Path = (Resolve-Path -LiteralPath $localAsset).Path; Temporary = $false }
    }

    $download = Join-Path ([IO.Path]::GetTempPath()) $AssetName
    $url = "https://github.com/$Repo/releases/download/v$Version/$AssetName"
    Write-Host "Downloading $url"
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $download
    if (-not (Test-Path -LiteralPath $download)) {
        throw "Download failed: $url"
    }
    return @{ Path = $download; Temporary = $true }
}

function Resolve-Editors {
    $order = @('code', 'code-insiders', 'trae-cn', 'trae')
    if ($Editor -ne 'auto') {
        $order = @($Editor)
    }

    $found = @()
    foreach ($name in $order) {
        $source = Find-EditorCommand $name
        if (-not $source) {
            if ($Editor -ne 'auto') {
                throw "Editor CLI not found: $name"
            }
            continue
        }
        if ($found | Where-Object { $_.Source -eq $source }) {
            continue
        }
        $found += [pscustomobject]@{ Name = $name; Source = $source }
    }

    if (-not $found) {
        throw 'No supported editor CLI found. Add code, code-insiders, trae-cn, or trae to PATH.'
    }
    return $found
}

$vsix = Resolve-Vsix
$editors = Resolve-Editors

try {
    Write-Host "Synapse Companion $Version"
    Write-Host "VSIX: $($vsix.Path)"
    foreach ($target in $editors) {
        $arguments = @('--install-extension', $vsix.Path)
        if ($Force) {
            $arguments += '--force'
        }
        if ($DryRun) {
            Write-Host "[dry-run] $($target.Source) $($arguments -join ' ')"
            continue
        }

        Write-Host "Installing into $($target.Name) ($($target.Source))"
        & $target.Source @arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Extension installation failed for $($target.Name) with exit code $LASTEXITCODE"
        }

        $installed = & $target.Source --list-extensions --show-versions |
            Where-Object { $_ -like "$ExtensionId@*" }
        if ($installed) {
            Write-Host "Installed: $installed"
        }
    }

    Write-Host 'Done. Open the Synapse activity-bar icon, or run "Synapse: Open Companion Sidebar".'
} finally {
    if ($vsix.Temporary -and (Test-Path -LiteralPath $vsix.Path)) {
        Remove-Item -LiteralPath $vsix.Path -Force -ErrorAction SilentlyContinue
    }
}
