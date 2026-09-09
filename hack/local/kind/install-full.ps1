param(
    [string]$Context = 'kind-mlrun',
    [string]$HelmPath = 'helm',
    [string]$Proxy = ''
)
$ErrorActionPreference = 'Stop'
$rootDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$cacheDirectory = Join-Path $rootDirectory 'playground/full-install'
New-Item -ItemType Directory -Force $cacheDirectory | Out-Null

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

function New-LocalSecret {
    param([string]$Name, [hashtable]$Values)
    & kubectl --context $Context -n mlrun get secret $Name -o name 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    $secret = @{apiVersion='v1'; kind='Secret'; metadata=@{name=$Name; namespace='mlrun'}; stringData=$Values}
    $secret | ConvertTo-Json -Depth 8 -Compress | & kubectl --context $Context apply -f -
    if ($LASTEXITCODE -ne 0) { throw "Creating $Name failed." }
}

function New-Password {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

Get-Command kubectl, docker, $HelmPath -ErrorAction Stop | Out-Null
Invoke-Checked kubectl @('--context',$Context,'get','nodes')
# Build and import the bilingual UI with the CE workflow permission fix before changing workloads.
if (-not $Context.StartsWith('kind-')) { throw 'This installer requires a kind context.' }
& "$PSScriptRoot/build-sql-datasets.ps1" -ClusterName $Context.Substring(5)
& "$PSScriptRoot/build-ui.ps1" -ClusterName $Context.Substring(5) -Proxy $Proxy
& "$PSScriptRoot/build-nuclio-ui.ps1" -ClusterName $Context.Substring(5) -Proxy $Proxy
Invoke-Checked kubectl @('--context',$Context,'apply','-f',"$PSScriptRoot/mlrun.yaml")
New-LocalSecret 'grafana-admin' @{'admin-user'='admin'; 'admin-password'=(New-Password)}
New-LocalSecret 'mlrun-platform-credentials' @{
    POSTGRES_PASSWORD=(New-Password)
    AWS_ACCESS_KEY_ID='minio'
    AWS_SECRET_ACCESS_KEY='minio123'
}

# Use the same downloaded and hashed chart versions on every machine.
$charts = Get-Content "$PSScriptRoot/charts.lock.json" -Raw | ConvertFrom-Json
$chartPaths = @{}
foreach ($chart in $charts) {
    $package = Join-Path $cacheDirectory "$($chart.name)-$($chart.version).tgz"
    if (-not (Test-Path -LiteralPath $package)) {
        $downloadArgs = @('--fail','--location','--retry','3','--output',$package,$chart.url)
        if ($Proxy) { $downloadArgs += @('--proxy',$Proxy) }
        Invoke-Checked curl.exe $downloadArgs
    }
    if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $chart.sha256) {
        throw "Checksum mismatch: $package. Remove that download and retry."
    }
    $chartPaths[$chart.name] = $package
}

Invoke-Checked kubectl @('--context',$Context,'apply','-f',"$PSScriptRoot/registry.yaml",'-f',"$PSScriptRoot/local-access.yaml")
& "$PSScriptRoot/configure-registry.ps1" -Context $Context
Invoke-Checked kubectl @('--context',$Context,'apply','--server-side','-f',"$PSScriptRoot/vendor/kfp-crds.yaml")
Invoke-Checked kubectl @('--context',$Context,'apply','-f',"$PSScriptRoot/vendor/kfp-app.yaml",'-f',"$PSScriptRoot/vendor/metrics-server.yaml")

$releases = @(
    @{Name='nuclio'; Chart='nuclio'; Extra=@('-f',"$PSScriptRoot/nuclio-values.yaml")},
    @{Name='kafka-operator'; Chart='strimzi-kafka-operator'; Extra=@()},
    @{Name='spark-operator'; Chart='spark-operator'; Extra=@('-f',"$PSScriptRoot/spark-values.yaml")},
    @{Name='mpi-operator'; Chart='mpi-operator'; Extra=@('--set','crd.create=true','--set','crd.version=v1','--set','rbac.clusterResources.create=true')},
    @{Name='monitoring'; Chart='kube-prometheus-stack'; Extra=@('-f',"$PSScriptRoot/monitoring-values.yaml")},
    @{Name='otel-operator'; Chart='opentelemetry-operator'; Extra=@('--set','admissionWebhooks.certManager.enabled=false','--set','admissionWebhooks.autoGenerateCert.enabled=true')}
)
foreach ($release in $releases) {
    Invoke-Checked $HelmPath (@('upgrade','--install',$release.Name,$chartPaths[$release.Chart],'-n','mlrun','--kube-context',$Context,'--timeout','15m') + $release.Extra)
}
Invoke-Checked kubectl @('--context',$Context,'-n','mlrun','rollout','status','deployment/otel-operator-opentelemetry-operator','--timeout=600s')
Invoke-Checked kubectl @('--context',$Context,'apply','-f',"$PSScriptRoot/kafka.yaml",'-f',"$PSScriptRoot/timescaledb.yaml",'-f',"$PSScriptRoot/telemetry.yaml",'-f',"$PSScriptRoot/dashboard.yaml")

# The published images omit the KFP compiler. Install it on the shared PVC,
# then load it in API/Jupyter; do not replace the SDK's core dependencies.
Invoke-Checked kubectl @('--context',$Context,'-n','mlrun','delete','job','mlrun-pipeline-sdk','--ignore-not-found')
Invoke-Checked kubectl @('--context',$Context,'apply','-f',"$PSScriptRoot/pipeline-sdk.yaml")
Invoke-Checked kubectl @('--context',$Context,'-n','mlrun','wait','--for=condition=complete','job/mlrun-pipeline-sdk','--timeout=900s')
Invoke-Checked kubectl @('--context',$Context,'apply','-f',"$PSScriptRoot/platform-env.yaml",'-f',"$PSScriptRoot/mlrun.yaml")
Invoke-Checked kubectl @('--context',$Context,'-n','mlrun','rollout','restart','deployment/mlrun-api','deployment/jupyter-notebook')
$deployments = & kubectl --context $Context -n mlrun get deployments -o name
if ($LASTEXITCODE -ne 0) { throw 'Listing deployments failed.' }
foreach ($deployment in $deployments) {
    Invoke-Checked kubectl @('--context',$Context,'-n','mlrun','rollout','status',$deployment,'--timeout=1200s')
}
Invoke-Checked kubectl @('--context',$Context,'-n','mlrun','wait','kafka/mlrun-kafka','--for=condition=Ready','--timeout=600s')
Invoke-Checked kubectl @('--context',$Context,'-n','kube-system','rollout','status','deployment/metrics-server','--timeout=600s')
Write-Host 'Platform ready. Run hack/local/kind/start-access.ps1 for the additional local dashboards.'
