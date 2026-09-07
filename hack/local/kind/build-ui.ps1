param(
    [string]$ClusterName = 'mlrun',
    [string]$Proxy = ''
)
$ErrorActionPreference = 'Stop'
$rootDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$cacheDirectory = Join-Path $rootDirectory 'playground/ui-release'
$commit = 'c4235698cba093958c02281cd20dbe0ab380230e'
$archiveHash = '98dd1234a72e4a170d5d1cb60849d34515c93afcb28c91718e76d7f9ba378934'
$image = 'mlrun/mlrun-ui:1.13.0-rc7-local.1'
$archive = Join-Path $cacheDirectory "$commit.zip"
$sourceDirectory = Join-Path $cacheDirectory "ui-$commit"
$imageDirectory = Join-Path $cacheDirectory 'image'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

Get-Command node, npm.cmd, git, docker, kind, curl.exe -ErrorAction Stop | Out-Null
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'UI source build requires Node.js 22 or newer.' }
New-Item -ItemType Directory -Force $cacheDirectory, $imageDirectory | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    $downloadArgs = @('--fail','--location','--retry','3','--output',$archive,"https://codeload.github.com/mlrun/ui/zip/$commit")
    if ($Proxy) { $downloadArgs += @('--proxy',$Proxy) }
    Invoke-Checked curl.exe $downloadArgs
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveHash) {
    throw "Checksum mismatch: $archive. Remove that download and retry."
}

# Re-extract the pristine source before applying the patch, including on reruns.
# Existing npm caches remain local; no project data or cluster resources are removed.
Expand-Archive -LiteralPath $archive -DestinationPath $cacheDirectory -Force
Invoke-Checked git @('-C',$sourceDirectory,'init','--quiet')
Invoke-Checked git @('-C',$sourceDirectory,'apply','--check',"$PSScriptRoot/ui/workflow-permissions.patch")
Invoke-Checked git @('-C',$sourceDirectory,'apply',"$PSScriptRoot/ui/workflow-permissions.patch")
Copy-Item -LiteralPath "$PSScriptRoot/ui/workflow-permissions.test.js" -Destination "$sourceDirectory/src/components/Workflow/workflow-permissions.test.js" -Force
Push-Location $sourceDirectory
try {
    # Use the upstream lock; skip browser-driver downloads and preinstall lock rewrites.
    $npmArgs = @('ci','--ignore-scripts','--no-audit','--no-fund')
    if ($Proxy) { $npmArgs += @('--https-proxy',$Proxy) }
    Invoke-Checked npm.cmd $npmArgs
    Invoke-Checked node @('node_modules/vitest/vitest.mjs','run','src/components/Workflow/workflow-permissions.test.js')
    Invoke-Checked node @('node_modules/eslint/bin/eslint.js','src/components/Workflow/workflow.util.js','src/components/Workflow/Workflow.jsx','src/elements/WorkflowsTable/WorkflowsTable.jsx')
    Invoke-Checked node @('node_modules/vite/bin/vite.js','build')
} finally {
    Pop-Location
}

# A small build context keeps node_modules out of the Docker build upload.
Copy-Item -LiteralPath "$sourceDirectory/build" -Destination $imageDirectory -Recurse -Force
Copy-Item -LiteralPath "$PSScriptRoot/ui/Dockerfile" -Destination "$imageDirectory/Dockerfile" -Force
Invoke-Checked docker @('build','--tag',$image,$imageDirectory)
Invoke-Checked kind @('load','docker-image',$image,'--name',$ClusterName)
Write-Host "UI image ready in kind cluster ${ClusterName}: $image"
