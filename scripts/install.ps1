#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Version = '0.1.1',

    [ValidateSet('auto', 'code', 'code-insiders')]
    [string]$Editor = 'auto',

    [string]$VsixPath,

    [string]$RuntimePath,

    [string]$UvPath,

    [switch]$Force,

    [switch]$NoPath,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Repo = 'kinguang3/Synapse'
$ExtensionId = 'synapse-local.synapse-companion'
$AssetName = "synapse-companion-$Version.vsix"
$IsWindowsHost = $env:OS -eq 'Windows_NT'

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
}

function Find-Uv {
    if ($UvPath) {
        $resolved = (Resolve-Path -LiteralPath $UvPath).Path
        return $resolved
    }
    $command = Get-Command uv -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }
    throw 'uv is required. Install it from https://docs.astral.sh/uv/ and rerun this script.'
}

function Get-DataHome {
    if ($env:SYNAPSE_HOME) {
        return [IO.Path]::GetFullPath($env:SYNAPSE_HOME)
    }
    if ($IsWindowsHost) {
        $base = $env:LOCALAPPDATA
        if (-not $base) {
            $base = Join-Path $env:USERPROFILE 'AppData\Local'
        }
        return (Join-Path $base 'Synapse\Synapse')
    }
    if ($env:XDG_DATA_HOME) {
        return (Join-Path $env:XDG_DATA_HOME 'Synapse')
    }
    return (Join-Path $HOME '.local\share\Synapse')
}

function Get-RuntimePaths {
    param([string]$Root)
    $rootPath = if ($RuntimePath) {
        [IO.Path]::GetFullPath($RuntimePath)
    } else {
        Join-Path $Root 'runtime'
    }
    if ($IsWindowsHost) {
        $bin = Join-Path $rootPath 'Scripts'
        $python = Join-Path $bin 'python.exe'
        $synapse = Join-Path $bin 'synapse.exe'
    } else {
        $bin = Join-Path $rootPath 'bin'
        $python = Join-Path $bin 'python'
        $synapse = Join-Path $bin 'synapse'
    }
    return [pscustomobject]@{
        Root = $rootPath
        Bin = $bin
        Python = $python
        Synapse = $synapse
    }
}

function Find-EditorCommand {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    if (-not $IsWindowsHost -or $Name -ne 'code') {
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

function Resolve-Editors {
    $order = @('code', 'code-insiders')
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
        throw 'No supported VS Code-compatible editor CLI found. Install a VS Code-compatible editor and ensure its CLI is on PATH.'
    }
    return $found
}

function Resolve-Vsix {
    if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$') {
        throw "Invalid version: $Version"
    }

    if ($VsixPath) {
        $resolved = (Resolve-Path -LiteralPath $VsixPath).Path
        return @{ Path = $resolved; Temporary = $false }
    }

    $localAsset = if ($PSScriptRoot) {
        Join-Path (Split-Path -Parent $PSScriptRoot) "dist\$AssetName"
    } else {
        $null
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

function Add-UserPath {
    param([string]$Directory)
    if ($DryRun) {
        Write-Host "[dry-run] add to user PATH: $Directory"
        return
    }
    if (-not $IsWindowsHost) {
        Write-Host "Add this directory to PATH: $Directory"
        return
    }

    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($current) {
        $parts = @($current -split ';' | Where-Object { $_.Trim() })
    }
    $alreadyPresent = $parts | Where-Object { $_.TrimEnd('\') -ieq $Directory.TrimEnd('\') }
    if (-not $alreadyPresent) {
        $updated = if ($current) { $current.TrimEnd(';') + ';' + $Directory } else { $Directory }
        [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
        Write-Host "Added to user PATH: $Directory"
    }
    if (-not (($env:Path -split ';') -contains $Directory)) {
        $env:Path = "$Directory;$env:Path"
    }
}

function Install-Runtime {
    param(
        [string]$Uv,
        [string]$Runtime,
        [string]$Python,
        [string]$Version
    )

    if ($DryRun) {
        Write-Host "[dry-run] $Uv venv --python 3.11 --allow-existing $Runtime"
        Write-Host "[dry-run] $Uv pip install --python $Python --upgrade `"synapse-knowledge[gui]==$Version`""
        return
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $Runtime) -Force | Out-Null

    if (-not (Test-Path -LiteralPath $Python)) {
        Write-Step 'Creating Synapse runtime'
        & $Uv venv --python 3.11 --allow-existing $Runtime
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create the Synapse runtime (exit code $LASTEXITCODE)."
        }
    }

    Write-Step "Installing Synapse $Version with GUI support"
    & $Uv pip install --python $Python --upgrade "synapse-knowledge[gui]==$Version"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Synapse (exit code $LASTEXITCODE)."
    }

    $installed = (& $Python -c 'import synapse; print(synapse.__version__)').Trim()
    if ($installed -ne $Version) {
        throw "Installed version mismatch: expected $Version, got $installed."
    }
    & $Python -c 'from synapse.integrations.gui.app import create_app' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'GUI dependencies are not available in the Synapse runtime.'
    }
}

function Write-McpConfig {
    param(
        [string]$DataHome,
        [string]$Python
    )

    $config = [ordered]@{
        mcpServers = [ordered]@{
            synapse = [ordered]@{
                command = $Python
                args = @('-m', 'synapse.integrations.mcp')
                env = [ordered]@{ SYNAPSE_HOME = $DataHome }
            }
        }
    }
    $json = $config | ConvertTo-Json -Depth 6
    $path = Join-Path $DataHome 'mcp.json'

    if ($DryRun) {
        Write-Host "[dry-run] write MCP config: $path"
        Write-Host $json
        return $path
    }

    New-Item -ItemType Directory -Path $DataHome -Force | Out-Null
    [IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
    return $path
}

$uv = Find-Uv
$dataHome = Get-DataHome
$runtime = Get-RuntimePaths $dataHome
$editors = Resolve-Editors
$vsix = Resolve-Vsix

if ($vsix.Temporary) {
    $null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -SupportEvent -Action {
        Remove-Item -LiteralPath $Event.MessageData -Force -ErrorAction SilentlyContinue
    } -MessageData $vsix.Path
}

Install-Runtime -Uv $uv -Runtime $runtime.Root -Python $runtime.Python -Version $Version

if (-not $NoPath) {
    Add-UserPath $runtime.Bin
}

$mcpConfig = Write-McpConfig -DataHome $dataHome -Python $runtime.Python

Write-Step 'Installing the Synapse Companion sidebar'
foreach ($target in $editors) {
    $arguments = @('--install-extension', $vsix.Path)
    if ($Force) {
        $arguments += '--force'
    }
    if ($DryRun) {
        Write-Host "[dry-run] $($target.Source) $($arguments -join ' ')"
        continue
    }

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

if ($vsix.Temporary -and (Test-Path -LiteralPath $vsix.Path)) {
    Remove-Item -LiteralPath $vsix.Path -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "Synapse $Version is installed."
Write-Host "Runtime:   $($runtime.Root)"
Write-Host "MCP config: $mcpConfig"
if ($DryRun) {
    Write-Host '[dry-run] No changes were made.'
} else {
    Write-Host 'Restart your editor and terminal, then open the Synapse sidebar.'
    Write-Host 'The local GUI service starts automatically when the sidebar opens.'
}
