# MLRun 本地 Kubernetes 完整部署

本方案在 Windows Docker Desktop 的单节点 kind 集群中部署 MLRun 1.13.0-rc7，包含工作流、模型服务、模型监控、对象存储、镜像构建仓库及 Spark/MPI Operator。所有命令从仓库根目录运行。安装脚本保留已有集群、项目和 PVC。

## 版本与兼容性

以下是 2026-09-07～08 实际安装并验证的组合。Helm 下载地址及 SHA256 固定在 `charts.lock.json`，KFP/Argo 和 Metrics Server 清单保存在 `vendor/`，避免安装时混入浮动 `master` 镜像。

| 组件 | 安装版本 |
| --- | --- |
| MLRun API / UI / Jupyter / 计算镜像 | 1.13.0-rc7 |
| kind / Kubernetes | 0.33.0 / 1.37.0 |
| Kubeflow Pipelines 服务端 / Driver / Launcher | 2.17.2 |
| Argo Workflows | 4.0.5 |
| Nuclio / Helm Chart | 1.17.6 / 0.23.6 |
| Distribution 镜像仓库 | 3.1.1 |
| Strimzi / Kafka（KRaft） | 1.2.0 / 4.3.1 |
| TimescaleDB / PostgreSQL | 2.29.2 / 17.11 |
| kube-prometheus-stack / Prometheus Operator | 90.0.0 / 0.93.1 |
| Prometheus / Grafana / Alertmanager | 3.14.0 / 13.2.1 / 0.34.0 |
| OpenTelemetry Operator / Collector | 0.158.0（Chart 0.122.0）/ 0.160.0 |
| Metrics Server | 0.9.0 |
| Spark Operator / Spark 默认计算镜像 | 2.5.2 / 3.5.6 |
| MPI Operator / Chart | v0.2.3-igz / 0.7.1 |
| SeaweedFS / KFP MySQL / ML Metadata | 4.34 / 8.4 / 1.14.0 |
| MLRun 工作流编译 SDK / 发布镜像自带适配器 | KFP 1.8.24 / mlrun-pipelines-kfp-v1-8 0.8.0 |

依赖优先使用新版，但保留以下兼容边界：

- MLRun 1.13.0-rc7 发布镜像使用 KFP v1 适配器。验证发现 v2 适配器存在客户端接口、项目过滤和 PVC 挂载兼容问题，因此默认 Notebook 编译器保留 1.8.24，连接支持 v1 API 的 KFP 2.17.2 服务端。原生 KFP 2 工作流也已单独验证成功。
- MLRun 只支持 MPIJob `v1`/`v1alpha1`，不能直接改用仅提供 `v2beta1` 的最新 MPI Operator。配置使用受支持的 `v1`。
- Spark 计算镜像保留 MLRun CE 使用的 Spark 3.5 系列；MySQL、SeaweedFS、ML Metadata 随 KFP 清单配套，不独立替换存储格式或协议。
- 采用发布镜像，不会自动加载当前工作区 Python 源码。修改 SDK/API 代码须另行构建镜像。

这是完整功能的单节点开发部署。API 仍使用已有 SQLite 数据库以保留项目数据；共享卷使用 kind 本地存储，未配置生产级高可用、外部身份认证或 TLS。

## 前置条件

- Docker Desktop 已启动，使用 Linux containers。
- 安装 `kubectl`、`kind`、Helm 3，确保命令在 PATH 中。此次实际使用 Helm 3.18.6。
- 建议为 Docker 分配至少 16 GiB 内存；本机完整部署和模型监控运行时约占 12～13 GiB，训练或并行构建需要额外余量。
- 镜像和构建缓存较大，建议预留至少 80 GB 实际磁盘空间。Jupyter 镜像的 Docker 磁盘占用约 17.3 GB，Docker 与节点 containerd 缓存独立。
- 需要访问 Docker Hub、GHCR、Quay、registry.k8s.io、GCR 和 PyPI。脚本的 `-Proxy` 仅用于下载 Helm 包；容器拉取镜像仍依赖 Docker/节点的网络配置。

```powershell
docker version
kubectl version --client
kind version
helm version
```

工具下载：[kind](https://kind.sigs.k8s.io/docs/user/quick-start/)、[Helm](https://helm.sh/docs/intro/install/)。

## 首次创建与完整安装

```powershell
# 仅当列表中没有 mlrun 时，执行 create；已有集群直接跳过。
kind get clusters
kind create cluster --name mlrun --config hack/local/kind/cluster.yaml --wait 180s

# 安装/更新全部平台依赖；失败会停止，解决原因后可再次运行。
./hack/local/kind/install-full.ps1

# 若 Helm 不在 PATH，指定其完整路径；代理参数可省略。
# ./hack/local/kind/install-full.ps1 -HelmPath C:/tools/helm.exe -Proxy http://127.0.0.1:7897

# 启动附加管理页面的本地转发。
./hack/local/kind/start-access.ps1
```

本机已下载的 Helm 位于 `playground/helm/windows-amd64/helm.exe`，该目录不进入 Git；其他机器需自行安装 Helm。

默认由 Kubernetes 直接下载镜像，不必先执行 `docker pull` 和 `kind load`。只有节点无法下载、宿主机可以下载时，才使用下方的镜像导入流程。

脚本依次创建核心资源和随机凭据、安装 KFP/Argo 与 Operators、配置本地 HTTP 镜像仓库信任、安装 Kafka/TimescaleDB/监控、准备工作流 SDK 并等待所有 Deployment 就绪。`pipeline-sdk.yaml` 将编译器安装到共享 PVC 的 `.mlrun-kfp1`，通过 PYTHONPATH 加载，保留 MLRun 发布镜像内的核心 Python 依赖。

已有集群不要删除重建。`cluster.yaml` 只控制首次创建的 Docker 端口映射；修改它不会改变已有节点的主机端口。此前以 API 8080 创建的机器仍使用原端口，或额外运行 `kubectl --context kind-mlrun -n mlrun port-forward svc/mlrun-api 18080:8080`。

## 访问地址与端口规则

| 页面 | 当前本机地址 | 集群内地址 |
| --- | --- | --- |
| MLRun UI | http://127.0.0.1:4000 | mlrun-ui:80，容器监听 8090 |
| MLRun API | http://127.0.0.1:18080 | mlrun-api:8080 |
| JupyterLab | http://127.0.0.1:8888/lab | jupyter-notebook:8888 |
| Grafana | http://127.0.0.1:3000/d/mlrun-local | monitoring-grafana:80 |
| Nuclio | http://127.0.0.1:8070 | nuclio-dashboard:8070 |
| KFP 管理页面 | http://127.0.0.1:8880 | ml-pipeline-ui:80 |
| Prometheus | http://127.0.0.1:9090 | monitoring-prometheus:9090 |

前三个入口使用 kind 固定端口映射；后四个由 `start-access.ps1` 启动隐藏的 kubectl 进程。重启 Docker、关闭进程或转发目标 Pod 被替换后，重新运行该脚本。日志位于 `playground/access/`。脚本遇到其他程序占用端口会停止，不会静默改端口。

**集群内部始终使用 Service 地址和原始容器端口。** 主机 API 改为 18080 后，Notebook 的 `MLRUN_DBPATH` 仍为 `http://mlrun-api:8080`，UI 的 API/Nuclio 代理仍为完整集群域名。不要把主机端口填入这些内部地址。MLRun 镜像中的“Resource monitoring”快捷按钮受 Iguazio 会话条件限制，本地无认证部署可直接使用上表 Grafana 入口。Grafana 对外链接在 `platform-env.yaml` 的 `MLRUN_GRAFANA_URL` 中配置。

所有主机入口只绑定 `127.0.0.1`。API/Jupyter/Nuclio 是本地无认证模式，不应直接暴露公网。Grafana 用户名 `admin`，密码在 Kubernetes Secret 中，可在自己的终端读取：

```powershell
$encoded = kubectl --context kind-mlrun -n mlrun get secret grafana-admin -o 'jsonpath={.data.admin-password}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
```

安装脚本不会覆盖已有 Secret，也不会将随机密码写入 Git。本机首次安装时另存了 `playground/grafana-admin.txt`。

## 功能验收与日常检查

```powershell
kubectl --context kind-mlrun -n mlrun get deployments,pods,pvc
kubectl --context kind-mlrun -n mlrun get kafka,nucliofunctions,workflows
kubectl --context kind-mlrun top nodes
curl.exe --fail http://127.0.0.1:18080/api/healthz
curl.exe --fail http://127.0.0.1:4000/mlrun/api/v1/projects
curl.exe --fail http://127.0.0.1:4000/mlrun/nuclio/api/functions
```

实际验收记录（2026-09-07～08）：

- MLRun 核心服务和依赖 Deployment 就绪，API 返回 `1.13.0-rc7`。
- 工作流 `mlrun-sdk-workflow-w47hf` 成功，MLRun 项目 `deployment-smoke`，运行 ID `8eff1fb7-08ec-4337-aaf8-b19262223717`；通过 MLRun SDK 提交并在 MLRun 工作流列表中显示 `Succeeded`。
- 原生 KFP 2.17 工作流也完成，验证 Argo 执行、SeaweedFS S3 产物写入及元数据服务；临时 KFP 测试已归档并清理，保留 MLRun SDK 验收记录。
- `serving-smoke` 完成 Kaniko 构建、仓库推送、节点拉取和 Nuclio 部署；输入 `[2,5,9]` 得到 `[4,10,18]`。
- `deployment-smoke` 的 model-monitoring-controller、stream、writer 全部 Ready；30 次带监控推理后，TimescaleDB 的 predictions 表写入 30 条记录。
- OpenTelemetry 指标已被 Prometheus 抓取；Grafana 配置了 MLRun 平台概览，包含项目、函数、模型端点、API 请求量和延迟。
- 自动挂载 PVC 的 Kubernetes 作业读取到了 Notebook 生成的数据集。原来失败的 `trainer`/`auto-trainer` 记录予以保留，不代表新部署未就绪。
- 浏览器验证通过项目概览、工作流列表/执行图/任务详情，以及模型端点列表/监控详情；Nuclio 概览正确显示 4 个 Running 函数。
- Spark/MPI Operator 与 CRD 已安装；未对用户的实际 Spark/MPI 分布式训练进行验收。

## Notebook 作业与模型监控

Notebook 和作业会自动挂载 `mlrun-data` 到 `/home/jovyan/data`。Notebook、数据集、代码和需要持久化的模型应保存到该目录，其他目录在 Pod 重建后可能丢失。

```python
import mlrun

project = mlrun.get_or_create_project(
    "my-project", context="/home/jovyan/data/my-project", user_project=False
)
function = mlrun.new_function(
    name="job-smoke", project=project.name, kind="job",
    image="mlrun/mlrun:1.13.0-rc7",
)
function.with_code(body='def handler(context):\n    context.log_result("answer", 42)\n')
run = function.run(handler="handler", watch=True)
assert run.status.results["answer"] == 42
```

不要使用 `mlrun/mlrun-api` 作为计算镜像，它会按 API 服务角色初始化。新版手工挂载函数在 `mlrun.runtimes.mounts`，不是旧的 `mlrun.platforms.mount_pvc`。

模型监控按项目启用。平台已安装 Kafka 和 TimescaleDB，新建项目后在 Notebook 中注册其数据存储配置：

```python
import os
from mlrun.datastore.datastore_profile import (
    DatastoreProfileKafkaStream, DatastoreProfilePostgreSQL,
)

project.register_datastore_profile(DatastoreProfilePostgreSQL(
    name="local-timescaledb", host="mlrun-timescaledb.mlrun.svc.cluster.local",
    port=5432, user="postgres", password=os.environ["POSTGRES_PASSWORD"],
    database="mlrun",
))
project.register_datastore_profile(DatastoreProfileKafkaStream(
    name="local-kafka",
    brokers=["mlrun-kafka-kafka-bootstrap.mlrun.svc.cluster.local:9092"],
    topics=[],
))
project.set_model_monitoring_credentials(
    tsdb_profile_name="local-timescaledb", stream_profile_name="local-kafka",
)
project.enable_model_monitoring(
    image="mlrun/mlrun:1.13.0-rc7",
    deploy_histogram_data_drift_app=False,
    wait_for_deployment=False,
)
# 在自己的 serving_fn 上启用监控后再部署：
# serving_fn.set_tracking()
# serving_fn.deploy()
```

示例启用基础预测监控。需要直方图漂移分析时，将 `deploy_histogram_data_drift_app` 改为 `True` 并提供模型的参考统计数据；这会额外部署监控应用并占用资源。TimescaleDB 会根据 MLRun system_id 创建 `mlrun_mm_<system_id>` 数据库。平台不自动为所有已有项目创建监控服务。

## 重启、存储和备份

```powershell
# 重启核心服务，保留数据。
kubectl --context kind-mlrun -n mlrun rollout restart deployment/mlrun-api deployment/mlrun-ui deployment/jupyter-notebook
# 配置文件变化后重新应用全部部署。
./hack/local/kind/install-full.ps1
./hack/local/kind/start-access.ps1
```

持久卷包括 MLRun SQLite/数据、KFP MySQL/SeaweedFS、镜像仓库、Kafka、TimescaleDB、Prometheus 和 Grafana。kind 的本地存储声明容量不等同于磁盘配额，应同时监控 Docker 实际磁盘用量。

**删除 kind 集群、命名空间或 PVC 可能永久删除数据。** 更换机器前应导出 MLRun 数据卷，并分别备份 MySQL、PostgreSQL、SeaweedFS 和镜像仓库；不能通过重新 `kind create cluster` 恢复旧项目。

## loading / 启动等待排查

`kind load docker-image` 是镜像导入，不是服务启动；大型镜像没有持续百分比输出。保留导入终端，在另一个终端检查：

```powershell
docker stats mlrun-control-plane
docker exec mlrun-control-plane crictl images | Select-String mlrun
docker exec mlrun-control-plane df -h /var/lib/containerd
```

CPU 和 BLOCK I/O 持续变化通常说明正在传输或解包。磁盘充足并不代表导入已完成。需要离线导入时逐个执行，集群名必须为 `mlrun`：

```powershell
docker pull mlrun/mlrun-api:1.13.0-rc7
kind load docker-image mlrun/mlrun-api:1.13.0-rc7 --name mlrun -v 6
docker pull mlrun/mlrun-ui:1.13.0-rc7
kind load docker-image mlrun/mlrun-ui:1.13.0-rc7 --name mlrun -v 6
docker pull mlrun/jupyter:1.13.0-rc7
kind load docker-image mlrun/jupyter:1.13.0-rc7 --name mlrun -v 6
```

`rollout status` 长时间显示 `0 of 1 updated replicas are available` 时，应查看 Pod 事件和日志：

```powershell
kubectl --context kind-mlrun -n mlrun get pods
kubectl --context kind-mlrun -n mlrun get events --sort-by=.lastTimestamp
kubectl --context kind-mlrun -n mlrun describe pod <pod-name>
kubectl --context kind-mlrun -n mlrun logs <pod-name> --all-containers --tail=100
kubectl --context kind-mlrun -n mlrun logs <pod-name> --previous --tail=100
```

- `ImagePullBackOff`：先区分网络超时、认证、镜像标签不存在；不要重复重建集群。
- UI 显示 Nuclio is not deployed：在 UI Deployment 设置 `MLRUN_NUCLIO_MODE=enabled`，并将 `MLRUN_NUCLIO_UI_URL` 指向主机的 8070 入口。
- UI 工作流 500 / Nuclio 502：确认 KFP/Nuclio Ready、完整 Service 域名及 `local-access.yaml`。KFP 网络策略曾阻断主机访问，需保留核心入口的允许规则。
- 工作流详情报 forEach 异常：不要在 Argo `workflowDefaults.templateDefaults` 中对所有模板隐式注入 retryStrategy。MLRun UI 不支持根节点是 Retry 的执行图；清单已移除该全局默认，任务重试可在工作流中显式配置。已有这类执行图不会被重写。
- KFP driver 参数不匹配：Driver、Launcher 和 API 均须固定 `2.17.2`，不要使用 `master`。
- metadata-writer 反复重启：`POD_NAMESPACE` 必须来自 Pod 命名空间，否则会连接不存在的 `metadata-grpc-service.kubeflow`。
- S3 写入错误：检查 `kfp-launcher` 的 endpoint、`region: us-east-1` 及凭据引用。
- Nuclio 镜像推送成功但 Pod 拉取失败：重新运行 `configure-registry.ps1`；节点必须将本地仓库映射到 Service IP 并使用 HTTP。
- 训练找不到 Notebook 生成的文件：确认文件位于 `/home/jovyan/data`，并保留 `MLRUN_STORAGE__AUTO_MOUNT_TYPE=pvc` 及对应挂载参数。
- 内存不足或 OOMKilled：增加 Docker 资源或减少并行作业/监控项目数量；不要通过修改不相关服务端口解决。

## 上游来源

- [MLRun CE](https://github.com/mlrun/ce)
- [KFP 2.17.2](https://github.com/kubeflow/pipelines/tree/2.17.2/manifests)
- [Nuclio Helm](https://nuclio.github.io/nuclio/charts/)
- [Metrics Server](https://github.com/kubernetes-sigs/metrics-server/releases)
- [Prometheus Helm](https://github.com/prometheus-community/helm-charts)
- [Strimzi](https://strimzi.io/)
- [OpenTelemetry Helm](https://github.com/open-telemetry/opentelemetry-helm-charts)
