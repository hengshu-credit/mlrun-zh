# SQL 查询数据集

在项目的「数据集」页面点击「SQL 数据集」，即可把 MySQL/PostgreSQL 查询结果保存为平台管理的 Parquet 快照。注册成功后，它与其他平台数据集使用相同的读取方式，可用于特征加工和模型训练。

## 使用流程

1. 新建连接：填写连接名称、数据库类型、主机、端口、数据库、用户名和密码。主机必须能从 API 和导入 Job 所在集群访问。密码使用平台项目 Secret 保存。
2. 测试并保存连接。请使用仅有查询权限的业务数据库账号。
3. 填写数据集名称、选择连接、输入查询 SQL；参数使用 JSON 对象。
4. 点击预览，检查列名与样例数据。预览最多 50 行。
5. 注册并导入。平台创建独立 Job，查询结果分批写入 Parquet，完整上传后注册数据集。
6. 后续点击主动更新，重新执行保存的查询并发布新快照。刷新失败时原有数据集继续可用；重新打开窗口可以恢复最新任务状态。

例如，SQL 可以填写：

```sql
SELECT customer_id, age, income, defaulted
FROM customer_training_samples
WHERE updated_at >= :start_time
```

参数填写：

```json
{"start_time": "2026-01-01"}
```

数据集注册成功后，在特征集的数据源中选择 **PARQUET → MLRun store → Datasets**，选择该数据集。训练任务的数据输入同样选择平台数据集。

SDK 读取示例：

```python
import mlrun

data = mlrun.get_dataitem("store://datasets/my-project/customer-samples:latest")
df = data.as_df()
```

需要复现实验时，请保存并使用导入任务返回的 `dataset_uri`（包含确定版本 UID）。`latest` 表示最近成功发布的版本，后续刷新会改变它指向的数据；运行中的自定义代码如果重复读取 latest，不会自动固定版本。

## 边界

- 首期支持 MySQL 和 PostgreSQL，单条 SELECT 或查询型 CTE，参数仅支持 JSON 标量；不执行多语句、写入 SQL 或优化器提示。
- 连接和查询定义首次保存后保持不变；新查询使用新名称。主动更新执行原定义的全量查询，不是增量追加或 CDC。
- 默认最多 100 万行、300 秒；API 允许设置最多 1000 万行、3600 秒。单次快照的未压缩 Arrow 数据上限为 1 GiB；预览输出上限为 2 MiB。
- 空结果、列名重复、不能转换为 Parquet 的类型或超限均视为导入失败，不会发布空数据替换旧快照。复杂 JSON/数组等数据库字段建议在 SQL 中显式转换类型并设置列别名。
- 每次成功导入使用独立物理文件和 artifact 版本。并发更新按成功完成顺序更新 latest。旧版本可以继续通过确定 UID 读取；本功能不自动清理旧快照。
- 特征集已物化的结果和训练模型不会因原始数据集刷新而自动重算，需要重新运行相应加工或训练任务。
- 当前连接表单未提供自定义 TLS/证书配置；需要强制证书校验的远程数据库应先扩展连接选项。本地开发连接不代表生产 TLS 配置。

## 构建和部署

在仓库根目录运行：

```powershell
./hack/local/kind/build-sql-datasets.ps1
./hack/local/kind/build-ui.ps1
kubectl --context kind-mlrun -n mlrun set image deployment/mlrun-api mlrun-api=mlrun/mlrun-api:1.13.0-rc7-sql.1
kubectl --context kind-mlrun -n mlrun set image deployment/mlrun-ui mlrun-ui=mlrun/mlrun-ui:1.13.0-rc7-local.11
```

API 镜像和导入 Job 使用包含本功能的同一镜像；通过 `MLRUN_SQL_DATASET__JOB_IMAGE` 指定。未配置可用镜像时 API 拒绝注册导入，防止提交缺少执行模块的任务。镜像沿用 rc7 的数据库驱动和运行依赖，不修改平台元数据库结构。

## 已验证的行为

2026-09-08，在本地 kind 平台完成以下验证：

- 22 项 API 测试及 26 项执行引擎/真实数据库测试通过；前端完整构建的 155 项测试通过，补丁首次应用和重复应用回归测试通过。
- PostgreSQL 和 MySQL 均实际提交集群 Job，成功注册 Parquet 数据集；重开页面能恢复连接、查询定义和最新任务状态。
- PostgreSQL 源表从 3 行增加到 4 行后主动刷新：latest 为 4 行，固定版本 URI 仍读取到原来的 3 行。
- 模拟源表不可用使刷新失败，最近成功快照仍可读取。
- 使用平台 DataItem、ParquetSource 读取快照，执行特征集 OneHotEncoder 加工并写出目标，以及训练 DecisionTreeClassifier。
- MySQL 的 `9007199254740993` 与 NULL 列，经快照和默认 `as_df()` 读取后保留 `Int64` 精度；快照描述、来源记录及最终 schema 已验证。

新增功能文件的 Ruff 检查和格式检查通过。扩展检查 `mlrun/config.py` 时发现 5 个位于未修改代码中的现有 Ruff 问题；没有改动这些无关代码，未声称全仓库 lint 或全部测试通过。
