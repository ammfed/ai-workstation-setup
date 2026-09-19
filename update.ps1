# update.ps1 - get the template's latest version on native Windows.
#
# The updater itself is lib/update.mjs: a fast-forward only update that never
# touches your answers or other gitignored files and refuses (explaining why)
# when the clone has local changes or has diverged. It needs Node.js, which
# install.ps1 set up. Run:  powershell -ExecutionPolicy Bypass -File .\update.ps1 --help

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'The updater needs Node.js. Run .\install.ps1 once to set it up, then re-run .\update.ps1.'
    exit 2
}

& node (Join-Path $here 'lib/update.mjs') @args
exit $LASTEXITCODE
