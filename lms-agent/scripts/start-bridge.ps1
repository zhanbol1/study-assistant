$ErrorActionPreference = 'Stop'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PSScriptRoot '..\.playwright-browsers'
node (Join-Path $PSScriptRoot '..\src\bridge\server.js')
