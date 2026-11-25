[CmdletBinding()]
param(
    [switch]$Deep
)

$ErrorActionPreference = "Stop"

$required = @("synapse", "synapse-mcp")
$missing = @()

foreach ($name in $required) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        $missing += $name
        continue
    }
    Write-Output "$name -> $($command.Source)"
}

if ($missing.Count -gt 0) {
    Write-Output "missing: $($missing -join ', ')"
    Write-Output "install with: uv tool install synapse-knowledge"
    exit 1
}

& synapse version
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if ($Deep) {
    & synapse projects list --json
    exit $LASTEXITCODE
}
