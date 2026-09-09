param([string]$Context = 'kind-mlrun')
$ErrorActionPreference = 'Stop'
$demoProject = (Get-Content -LiteralPath "$PSScriptRoot/config.json" -Raw | ConvertFrom-Json).project
$settings = Get-Content -LiteralPath "$PSScriptRoot/config.json" -Raw | ConvertFrom-Json
$logDirectory = Join-Path $PSScriptRoot '../../../../playground/access'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$kubectlPath = (Get-Command kubectl -ErrorAction Stop).Source
$services = @(
    @{Name='transaction-model'; Service="nuclio-$demoProject-$($settings.model_function)"; Port=$settings.model_local_port},
    @{Name='transaction-features'; Service="nuclio-$demoProject-$($settings.feature_function)"; Port=$settings.feature_local_port}
)
foreach ($service in $services) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $service.Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($owner.CommandLine -notmatch 'port-forward' -or $owner.CommandLine -notmatch [regex]::Escape($service.Service)) {
            throw "Port $($service.Port) belongs to another process."
        }
    } else {
        $arguments = @('--context',$Context,'-n','mlrun','port-forward',"svc/$($service.Service)","$($service.Port):8080",'--address','127.0.0.1')
        Start-Process -FilePath $kubectlPath -ArgumentList $arguments -WindowStyle Hidden `
            -RedirectStandardOutput "$logDirectory/$($service.Name).log" `
            -RedirectStandardError "$logDirectory/$($service.Name).err" | Out-Null
    }
    Write-Host "$($service.Name): http://127.0.0.1:$($service.Port)"
}
