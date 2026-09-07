param([string]$Context = 'kind-mlrun', [string]$Cluster = 'mlrun')
$ErrorActionPreference = 'Stop'
$registryHost = 'mlrun-registry.mlrun.svc.cluster.local:5000'
$registryIp = & kubectl --context $Context -n mlrun get svc mlrun-registry -o 'jsonpath={.spec.clusterIP}'
if ($LASTEXITCODE -ne 0 -or -not $registryIp) { throw 'Cannot resolve the local registry Service.' }
$nodes = & docker ps --filter "label=io.x-k8s.kind.cluster=$Cluster" --format '{{.Names}}'
if (-not $nodes) { throw "No running kind nodes found for $Cluster." }
foreach ($node in $nodes) {
    $config = (& docker exec $node cat /etc/containerd/config.toml) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Cannot read containerd config on $node." }
    if ($config -notmatch 'config_path\s*=') {
        # The pinned kind node uses containerd's version 2 configuration.
        if ($config -notmatch 'version\s*=\s*2') { throw 'Review the registry plugin path for this containerd version.' }
        $config += "`n[plugins.`"io.containerd.grpc.v1.cri`".registry]`n  config_path = `"/etc/containerd/certs.d`"`n"
        $config | & docker exec -i $node sh -c 'cat > /etc/containerd/config.toml'
        if ($LASTEXITCODE -ne 0) { throw 'Writing containerd configuration failed.' }
        & docker exec $node systemctl restart containerd
        if ($LASTEXITCODE -ne 0) { throw 'Restarting containerd failed.' }
    } elseif ($config -notmatch 'config_path\s*=\s*"/etc/containerd/certs.d"') {
        throw 'The node uses another registry config_path; review it before modifying.'
    }
    $hostDirectory = "/etc/containerd/certs.d/$registryHost"
    & docker exec $node mkdir -p $hostDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Creating registry hosts directory failed.' }
    @"
server = "http://${registryIp}:5000"
[host."http://${registryIp}:5000"]
  capabilities = ["pull", "resolve"]
"@ | & docker exec -i $node sh -c "cat > '$hostDirectory/hosts.toml'"
    if ($LASTEXITCODE -ne 0) { throw 'Writing registry hosts configuration failed.' }
    Write-Host "Registry configured on $node ($registryIp)."
}
