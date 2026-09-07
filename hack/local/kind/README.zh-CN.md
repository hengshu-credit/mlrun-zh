# MLRun 本地 Kubernetes 部署

本方案在 Windows Docker Desktop 上使用 kind 创建单节点 Kubernetes，部署 MLRun API、UI 和 Jupyter。清单位于本目录的 `mlrun.yaml`，集群端口配置位于 `cluster.yaml`。所有命令从仓库根目录运行。

## 部署范围与版本

- kind：v0.33.0；Kubernetes 节点镜像：`kindest/node:v1.37.0`。
- MLRun API、UI、Jupyter：均为 `1.7.0`，与仓库 `hack/local/README.md` 指定版本一致。
- 使用发布镜像，不会构建或加载当前工作区源码。修改 Python 源码后，需要另行构建对应镜像并更新 Deployment。
- 集群名称 `mlrun`，kubectl context `kind-mlrun`，命名空间 `mlrun`。
- 这是单节点开发/体验部署。未安装 Nuclio、Kubeflow Pipelines、Spark/MPI Operator、监控组件或镜像构建仓库；这些能力需要额外部署。
- 使用 SQLite 和单副本 API，不是高可用生产环境。正式环境应单独设计数据库、共享存储、认证、TLS 和备份。

## 前置条件

Docker Desktop 已启动并使用 Linux containers；安装 kubectl 和 kind，确保 Docker 有足够磁盘空间。Jupyter 镜像解压后约 8.44 GB，Docker 和 kind 节点各自保存镜像，首次部署需为镜像及数据预留额外空间。

本次运行环境：Docker Engine 29.6.1，Docker 可用内存约 15.5 GiB。主机的 4000、8080、8888 端口须空闲。

kind 安装位置：`C:\Users\Administrator\.local\bin\kind.exe`。如未安装，可在 PowerShell 中执行：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE/.local/bin" | Out-Null
curl.exe -fL -o "$env:USERPROFILE/.local/bin/kind.exe" https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-windows-amd64
$env:PATH = "$env:USERPROFILE/.local/bin;$env:PATH"
kind version
docker version
kubectl version --client
```

若 GitHub 直连超时，使用你自己的网络代理。本次下载通过本机 `http://127.0.0.1:7897` 完成；可在 curl 命令中增加 `--proxy http://127.0.0.1:7897`，该端口不是项目依赖。

## 启动

```powershell
Set-Location E:\workspace\mlrun
$env:PATH = "$env:USERPROFILE/.local/bin;$env:PATH"

# 仅首次创建；已有集群时直接跳过这一行
kind create cluster --name mlrun --config hack/local/kind/cluster.yaml --wait 180s

docker pull mlrun/mlrun-api:1.7.0
docker pull mlrun/mlrun-ui:1.7.0
docker pull mlrun/jupyter:1.7.0
kind load docker-image mlrun/mlrun-api:1.7.0 mlrun/mlrun-ui:1.7.0 mlrun/jupyter:1.7.0 --name mlrun

kubectl --context kind-mlrun apply -f hack/local/kind/mlrun.yaml
kubectl --context kind-mlrun -n mlrun rollout status deployment/mlrun-api --timeout=600s
kubectl --context kind-mlrun -n mlrun rollout status deployment/mlrun-ui --timeout=600s
kubectl --context kind-mlrun -n mlrun rollout status deployment/jupyter-notebook --timeout=600s
kubectl --context kind-mlrun -n mlrun get pods,svc,pvc
```

每条命令成功后再继续下一条。首次导入 Jupyter 大镜像可能耗时数分钟。后续启动无需重新创建集群或下载镜像，运行 `kubectl apply` 即可。

## 访问与健康检查

| 入口 | 本机地址 | 集群 Service / 目标端口 |
| --- | --- | --- |
| MLRun UI | http://127.0.0.1:4000 | mlrun-ui:80 → 8090 |
| MLRun API | http://127.0.0.1:8080 | mlrun-api:8080 → 8080 |
| JupyterLab | http://127.0.0.1:8888/lab | jupyter-notebook:8888 → 8888 |

UI 经 Nginx 将 `/api` 转发给 `http://mlrun-api.mlrun.svc.cluster.local:8080`。此处使用完整服务域名，避免 Nginx 动态 DNS 解析短服务名失败。1.7.0 UI 镜像实际监听 **8090**，所以本清单修正了旧示例中的容器端口 80。

```powershell
curl.exe --fail http://127.0.0.1:8080/api/healthz
curl.exe --fail http://127.0.0.1:8080/api/v1/projects
curl.exe --fail http://127.0.0.1:4000/api/v1/projects
curl.exe --fail -o NUL http://127.0.0.1:4000/
curl.exe --fail -o NUL http://127.0.0.1:8888/lab
```

本地方案关闭 API 和 Jupyter 登录认证，端口仅绑定 `127.0.0.1`。不要直接改成公网绑定；远程访问需先配置认证、TLS 或受控隧道。

Jupyter 中已配置 `MLRUN_DBPATH=http://mlrun-api:8080`。主机 Python SDK 应使用 `http://127.0.0.1:8080`，并与服务端 MLRun 版本保持一致。

## Kubernetes 作业验证

以下代码在 Jupyter Notebook 中执行，创建 `deployment-smoke` 项目并运行真实 Kubernetes Pod。复用已加载的 Jupyter 镜像，无需构建镜像或配置推送仓库。

```python
import mlrun
import mlrun.platforms

project = mlrun.get_or_create_project(
    "deployment-smoke", context="/tmp/deployment-smoke", user_project=False
)
function = mlrun.new_function(
    name="k8s-smoke", project=project.name,
    kind="job", image="mlrun/jupyter:1.7.0",
)
function.apply(mlrun.platforms.mount_pvc(
    pvc_name="mlrun-data", volume_mount_path="/home/jovyan/data"
))
function.with_code(body='def handler(context):\n    context.log_result("answer", 42)\n')
run = function.run(handler="handler", watch=True)
assert run.status.state == "completed"
assert run.status.results["answer"] == 42
```

不要将 `mlrun/mlrun-api` 当作作业镜像：它默认启用 `MLRUN_IS_API_SERVER`，直接用于任务执行会导致 launcher 初始化异常。业务作业应使用 SDK/计算镜像。

## 存储

| PVC | 大小申请 | 挂载位置 | 用途 |
| --- | --- | --- | --- |
| mlrun-db | 10 GiB | API 的 /mlrun/db | SQLite 数据库、运行日志 |
| mlrun-data | 10 GiB | API、Jupyter 的 /home/jovyan/data | 共享数据、实验产物、需要持久化的 Notebook |

使用 kind 默认 `standard` StorageClass 和 ReadWriteOnce PVC；两个应用在同一节点上共享数据卷。Notebook 请保存到 `/home/jovyan/data`，其他目录不会随 Pod 重建保留。

Pod 重启或重新应用清单不会删除 PVC。**删除 kind 集群会丢失节点内的卷数据**；删除命名空间/PVC 也可能触发存储回收。删除前须导出备份。多节点部署应改用适合实际集群的共享存储，不能直接沿用此单节点配置。

## 日常操作与排错

```powershell
kubectl --context kind-mlrun -n mlrun get pods,pvc
kubectl --context kind-mlrun -n mlrun get events --sort-by=.lastTimestamp
kubectl --context kind-mlrun -n mlrun logs deployment/mlrun-api --tail=100
kubectl --context kind-mlrun -n mlrun logs deployment/mlrun-ui --tail=100
kubectl --context kind-mlrun -n mlrun logs deployment/jupyter-notebook --tail=100

# 重启服务，保留持久卷
kubectl --context kind-mlrun -n mlrun rollout restart deployment/mlrun-api deployment/mlrun-ui deployment/jupyter-notebook

# 暂停应用，保留集群和数据
kubectl --context kind-mlrun -n mlrun scale deployment/mlrun-api deployment/mlrun-ui deployment/jupyter-notebook --replicas=0

# 恢复
kubectl --context kind-mlrun apply -f hack/local/kind/mlrun.yaml
```

- `ImagePullBackOff`：确认镜像已下载并通过 `kind load docker-image` 导入；Docker 的镜像缓存与节点 containerd 独立。
- PVC `Pending`：检查 `kubectl --context kind-mlrun get storageclass` 和 Pod 事件，默认存储采用延迟绑定，初次调度前短暂 Pending 正常。
- UI 502：先检查 API Ready 状态与 UI 到 API 的集群内连接；Nginx 报 `could not be resolved` 时确认代理地址使用完整服务域名。
- UI 探针连接拒绝：检查目标端口是否是 `8090`。
- Spark/MPI 资源不存在的日志：本方案没有安装相应 CRD，不能据此判断普通 job 运行失败；需要这些运行时再安装相应 Operator。
- 端口占用：首次创建集群前修改 `cluster.yaml` 中的 `hostPort`。已有集群修改文件不会自动更新 Docker 端口映射。

## 本次验收记录（2026-09-07）

- 三个 Deployment 均为 `1/1` Ready，两个 PVC 均为 Bound。
- API 健康检查、项目列表、UI 首页、UI 代理项目列表、JupyterLab 均返回 HTTP 200。
- Kubernetes 作业 `k8s-smoke-handler-bcgpt` 执行完成，结果 `answer=42`。
- 成功运行 UID：`e34868847f7548ae930768e8aaef3003`，项目：`deployment-smoke`，可在 UI 中查看。
- 重建 API Pod 后，项目与上述运行结果仍可读取，验证数据库卷持久化。
- Kubernetes 服务端 dry-run 校验通过。
- 首次使用 API 镜像执行的诊断任务曾失败，错误原因及正确作业镜像见上文；失败 Pod 已清理，项目中可能仍显示该诊断运行记录。

## 参考资料

- 仓库本地部署说明：[../README.md](../README.md)
- kind 官方安装与集群说明：https://kind.sigs.k8s.io/docs/user/quick-start/
- kind 端口映射说明：https://kind.sigs.k8s.io/docs/user/configuration/
