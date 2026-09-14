# install.ps1 - entry point on native Windows.
#
# The installer itself is lib/installer.mjs and needs Node.js 20+. This script
# only makes sure Node exists (offering to install it with winget), then hands
# every argument over. Run:  powershell -ExecutionPolicy Bypass -File .\install.ps1 --help

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeMin = 20
$dryRun = $args -contains '--dry-run'
$assumeYes = ($args -contains '--yes') -or ($args -contains '-y') -or ($args -contains '--non-interactive')

function Get-NodeMajor {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
    try { return [int](& node -p "process.versions.node.split('.')[0]") } catch { return 0 }
}

if ((Get-NodeMajor) -lt $nodeMin) {
    Write-Host "The installer needs Node.js $nodeMin+."
    $installCmd = 'winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements'
    if ($dryRun) {
        Write-Host "  ~ would run: $installCmd"
        Write-Host 'The rest of the plan needs Node.js. Install it (or run without --dry-run) and try again.'
        exit 0
    }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host 'winget is not available. Install Node.js LTS from https://nodejs.org and re-run.'
        exit 1
    }
    if (-not $assumeYes) {
        $reply = Read-Host 'Install Node.js LTS with winget now? [Y/n]'
        if ($reply -match '^(n|no)$') { Write-Host "Install Node.js $nodeMin+ and re-run."; exit 1 }
    }
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if ((Get-NodeMajor) -lt $nodeMin) {
        Write-Host 'Node.js is still not available. Open a new terminal and re-run .\install.ps1.'
        exit 1
    }
}

& node (Join-Path $here 'lib/installer.mjs') @args
exit $LASTEXITCODE
