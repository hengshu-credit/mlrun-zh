param(
    [string]$Context = 'kind-mlrun',
    [ValidateSet('all','prepare','backfill','train','deploy-features','deploy-model','verify')]
    [string]$Stage = 'all',
    [switch]$Redeploy
)
$ErrorActionPreference = 'Stop'
function Invoke-Kubectl {
    & kubectl --context $Context -n mlrun @args
    if ($LASTEXITCODE -ne 0) { throw "kubectl failed with exit code $LASTEXITCODE" }
}
$settings = Get-Content -LiteralPath "$PSScriptRoot/config.json" -Raw | ConvertFrom-Json
$remoteRoot = "/home/jovyan/data/$($settings.project)"
Invoke-Kubectl apply -f "$PSScriptRoot/redis.yaml"
Invoke-Kubectl rollout status deployment/mlrun-feature-redis --timeout=180s
$demoPod = Invoke-Kubectl get pod -l app=jupyter-notebook -o 'jsonpath={.items[0].metadata.name}'
$sourceFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in '.py','.json' } | Sort-Object Name)
$manifest = ($sourceFiles | ForEach-Object { "$($_.Name):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }) -join "`n"
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $release = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifest))).Replace('-','').ToLowerInvariant() }
finally { $hasher.Dispose() }
$remoteCode = "$remoteRoot/releases/$release"
Invoke-Kubectl @('exec',$demoPod,'--','mkdir','-p',$remoteCode)
$complete = Invoke-Kubectl @('exec',$demoPod,'--','python','-c',"from pathlib import Path; print(int(Path('$remoteCode/.complete').exists()))")
if ($complete.Trim() -ne '1') {
    foreach ($sourceFile in $sourceFiles) {
        $relativeSource = Resolve-Path -LiteralPath $sourceFile.FullName -Relative
        Invoke-Kubectl cp $relativeSource "${demoPod}:$remoteCode/$($sourceFile.Name)"
    }
    Invoke-Kubectl @('exec',$demoPod,'--','touch',"$remoteCode/.complete")
}
# Completed releases and the original deployed code directory are never overwritten.
Write-Host "Using preserved source release $release"
# setup_demo creates root/config.json only when missing; existing user settings are retained.
$stages = if ($Stage -eq 'all') { @('prepare','backfill','train','deploy-features','deploy-model','verify') } else { @($Stage) }
foreach ($item in $stages) {
    $stageArgs = @('exec',$demoPod,'--','python',"$remoteCode/setup_demo.py",$item,'--root',$remoteRoot)
    if ($Redeploy) { $stageArgs += '--redeploy' }
    Invoke-Kubectl @stageArgs
}
if ($Stage -eq 'all' -or $Stage -eq 'verify') { & "$PSScriptRoot/start-access.ps1" -Context $Context }
