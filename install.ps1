# install.ps1 - entry point on native Windows.
#
# The installer itself is lib/installer.mjs and needs Node.js 20+. Run with no
# options, this script asks one question (Linux inside Windows, Windows only, or
# choose each step), makes sure Node exists (installing it with winget), then
# hands every argument over. Run:  powershell -ExecutionPolicy Bypass -File .\install.ps1 --help

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeMin = 20
$argv = @($args)
$forward = $argv
$dryRun = $argv -contains '--dry-run'
$assumeYes = ($argv -contains '--yes') -or ($argv -contains '-y') -or ($argv -contains '--non-interactive')

# One question up front when nothing else says what to do. Either setup choice is the only
# yes needed: every dependency is then installed without asking again.
$chosen = @('--yes', '-y', '--non-interactive', '--modules', '--answers', '--list', '--help', '-h', '--platform') | Where-Object { $argv -contains $_ }
if (-not $chosen) {
    Write-Host 'How should this machine be set up?'
    Write-Host '  1) Linux inside Windows (recommended): installs WSL and Ubuntu, then everything inside it, firstmate included'
    Write-Host '  2) Windows only: Claude Code (command line and desktop app) and every tool that runs on Windows'
    Write-Host '  3) Let me pick modules and answer each question'
    Write-Host '  q) Stop'
    $reply = Read-Host 'Choice [1]'
    switch -Regex ($reply.Trim()) {
        '^(1|)$' { $forward = @('--modules', 'wsl', '--yes') + $argv; $assumeYes = $true }
        '^2$' { $forward = @('--yes') + $argv; $assumeYes = $true }
        '^3$' { }
        default { Write-Host 'Nothing was changed.'; exit 0 }
    }
}

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

& node (Join-Path $here 'lib/installer.mjs') @forward
exit $LASTEXITCODE
