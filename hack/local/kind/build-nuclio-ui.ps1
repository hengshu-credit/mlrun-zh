param(
    [string]$ClusterName = 'mlrun',
    [string]$Proxy = '',
    [string]$NodePath = 'node',
    [string]$KindPath = 'kind'
)
$ErrorActionPreference = 'Stop'
$rootDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$cacheDirectory = Join-Path $rootDirectory 'playground/nuclio-ui-build'
$commit = '4c28a83e688468da32d85ab07b76adc7a8e1a6b1'
$archiveHash = '50ec80f17d5fb1edbfe9e69a409bd904dbc60111fcce6ff390a1c6c629436b7f'
$image = 'mlrun/nuclio-dashboard:1.17.6-local.1'
$archive = Join-Path $cacheDirectory "$commit.zip"
$sourceDirectory = Join-Path $cacheDirectory "nuclio-$commit/pkg/dashboard/ui"
$imageDirectory = Join-Path $cacheDirectory 'image'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

Get-Command npm.cmd, docker, curl.exe, $NodePath -ErrorAction Stop | Out-Null
if ($KindPath -eq 'kind' -and -not (Get-Command kind -ErrorAction SilentlyContinue)) {
    $localKind = Join-Path $env:USERPROFILE '.local/bin/kind.exe'
    if (Test-Path -LiteralPath $localKind) { $KindPath = $localKind }
}
Get-Command $KindPath -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Force $cacheDirectory, $imageDirectory | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    $downloadArgs = @('--fail','--location','--retry','3','--output',$archive,"https://codeload.github.com/nuclio/nuclio/zip/$commit")
    if ($Proxy) { $downloadArgs += @('--proxy',$Proxy) }
    Invoke-Checked curl.exe $downloadArgs
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveHash) {
    throw "Checksum mismatch: $archive. Remove that download and retry."
}
# Re-extract pinned source on each run; npm caches remain local.
Expand-Archive -LiteralPath $archive -DestinationPath $cacheDirectory -Force
Push-Location $sourceDirectory
$previousSource = $env:NUCLIO_UI_SOURCE
try {
    $npmArgs = @('ci','--ignore-scripts','--no-audit','--no-fund')
    if ($Proxy) { $npmArgs += @('--https-proxy',$Proxy) }
    Invoke-Checked npm.cmd $npmArgs
    # Gulp loads this helper even for production builds; install from its own upstream lock.
    Push-Location 'resources/previewServer'
    try { Invoke-Checked npm.cmd $npmArgs } finally { Pop-Location }
    $env:NUCLIO_UI_SOURCE = $sourceDirectory
    Invoke-Checked $NodePath @("$PSScriptRoot/nuclio-ui/apply-bilingual.cjs",$sourceDirectory)
    Invoke-Checked $NodePath @("$PSScriptRoot/nuclio-ui/bilingual.test.cjs")
    Invoke-Checked $NodePath @('node_modules/gulp/bin/gulp.js','build','--production')
} finally {
    $env:NUCLIO_UI_SOURCE = $previousSource
    Pop-Location
}
Copy-Item -LiteralPath "$sourceDirectory/dist" -Destination $imageDirectory -Recurse -Force
Copy-Item -LiteralPath "$PSScriptRoot/nuclio-ui/Dockerfile" -Destination "$imageDirectory/Dockerfile" -Force
Invoke-Checked docker @('build','--tag',$image,$imageDirectory)
Invoke-Checked $KindPath @('load','docker-image',$image,'--name',$ClusterName)
Write-Host "Nuclio bilingual image ready in kind cluster ${ClusterName}: $image"
