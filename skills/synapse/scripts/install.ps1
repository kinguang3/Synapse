[CmdletBinding()]
param(
    [ValidateSet("Project", "User", "Custom")]
    [string]$Scope = "Project",
    [string]$Target,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$source = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) {
    Write-Output "source skill not found: $source"
    exit 1
}

switch ($Scope) {
    "Project" {
        $target = Join-Path (Get-Location).Path ".opencode\skills\synapse"
    }
    "User" {
        $target = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".config\opencode\skills\synapse"
    }
    "Custom" {
        if ([string]::IsNullOrWhiteSpace($Target)) {
            Write-Output "-Target is required when -Scope Custom is used"
            exit 1
        }
        $target = $Target
    }
}

$sourcePath = [System.IO.Path]::GetFullPath($source)
$targetPath = [System.IO.Path]::GetFullPath($target)
$separator = [System.IO.Path]::DirectorySeparatorChar
if ($targetPath -eq $sourcePath -or $targetPath.StartsWith($sourcePath + $separator)) {
    Write-Output "target must be outside the source skill directory"
    exit 1
}

if (Test-Path -LiteralPath $targetPath) {
    if (-not $Force) {
        Write-Output "target already exists: $targetPath"
        Write-Output "rerun with -Force to replace it"
        exit 1
    }
    Remove-Item -LiteralPath $targetPath -Recurse -Force
}

$parent = Split-Path -Parent $targetPath
New-Item -ItemType Directory -Path $parent -Force | Out-Null
New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
Copy-Item -Path (Join-Path $sourcePath "*") -Destination $targetPath -Recurse -Force

Write-Output "installed $sourcePath -> $targetPath"
