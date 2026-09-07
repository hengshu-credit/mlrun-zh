param([string]$Context = 'kind-mlrun')
$ErrorActionPreference = 'Stop'
$rootDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$logDirectory = Join-Path $rootDirectory 'playground/access'
New-Item -ItemType Directory -Force $logDirectory | Out-Null
$kubectlPath = (Get-Command kubectl -ErrorAction Stop).Source
$services = @(
    @{Name='grafana'; Service='monitoring-grafana'; Local=3000; Remote=80},
    @{Name='nuclio'; Service='nuclio-dashboard'; Local=8070; Remote=8070},
    @{Name='pipelines'; Service='ml-pipeline-ui'; Local=8880; Remote=80},
    @{Name='prometheus'; Service='monitoring-prometheus'; Local=9090; Remote=9090}
)
foreach ($service in $services) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $service.Local -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($owner.CommandLine -notmatch 'port-forward' -or $owner.CommandLine -notmatch [regex]::Escape($service.Service)) {
            throw "Port $($service.Local) belongs to another process. Resolve the conflict before starting access."
        }
    } else {
        $arguments = @('--context',$Context,'-n','mlrun','port-forward',"svc/$($service.Service)","$($service.Local):$($service.Remote)",'--address','127.0.0.1')
        $process = Start-Process -FilePath $kubectlPath -ArgumentList $arguments -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput "$logDirectory/$($service.Name).log" -RedirectStandardError "$logDirectory/$($service.Name).err"
        $process.Id | Set-Content "$logDirectory/$($service.Name).pid"
    }
    Write-Host "$($service.Name): http://127.0.0.1:$($service.Local)"
}
Write-Host 'Run this script again after Docker restarts or a forwarded Pod is replaced.'
