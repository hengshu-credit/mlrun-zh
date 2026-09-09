param(
    [string]$ClusterName = 'mlrun',
    [string]$KindPath = 'kind'
)
$ErrorActionPreference = 'Stop'
$sqlDatasetRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$sqlDatasetImage = 'mlrun/mlrun-api:1.13.0-rc7-sql.1'
if ($KindPath -eq 'kind' -and -not (Get-Command kind -ErrorAction SilentlyContinue)) {
    $sqlDatasetKind = Join-Path $env:USERPROFILE '.local/bin/kind.exe'
    if (Test-Path -LiteralPath $sqlDatasetKind) { $KindPath = $sqlDatasetKind }
}
$sqlDatasetContext = Join-Path $sqlDatasetRoot 'playground/sql-datasets-image'
New-Item -ItemType Directory -Force $sqlDatasetContext | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot/sql-datasets/Dockerfile" -Destination "$sqlDatasetContext/Dockerfile" -Force
Copy-Item -LiteralPath "$sqlDatasetRoot/mlrun/datastore/sql_dataset.py" -Destination "$sqlDatasetContext/sql_dataset.py" -Force
Copy-Item -LiteralPath "$sqlDatasetRoot/server/py/services/api/api/endpoints/sql_datasets.py" -Destination "$sqlDatasetContext/sql_datasets_endpoint.py" -Force
Copy-Item -LiteralPath "$sqlDatasetRoot/server/py/services/api/crud/sql_datasets.py" -Destination "$sqlDatasetContext/sql_datasets_crud.py" -Force
& docker build -t $sqlDatasetImage $sqlDatasetContext
if ($LASTEXITCODE -ne 0) { throw 'SQL dataset API/worker image build failed.' }
& $KindPath load docker-image $sqlDatasetImage --name $ClusterName
if ($LASTEXITCODE -ne 0) { throw 'SQL dataset image import into kind failed.' }
Write-Host "SQL dataset API/worker image ready: $sqlDatasetImage"
