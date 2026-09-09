# 交易流水特征池、历史回溯与模型在线服务

此示例在已有 MLRun 集群中配置 `transaction-feature-demo` 项目。流水、特征定义、训练快照、模型和在线函数全部保留。使用合成订单数据演示业务流程，不代表真实业务模型效果。

## 已配置的流程

```text
日志 / 交易流水 / 订单明细（HTTP JSON）
              ↓ 校验、event_id 去重
PostgreSQL 原始事件表（event_time + received_at）
              ↓ 同一套时间窗口聚合规则
       用户特征 + 订单特征
        ↙                  ↘
指定 as_of 回溯             实时 HTTP 特征返回
Parquet / MLRun 特征集      Redis 最新计算快照
        ↓                  ↓
按时间划分训练 / 验证       模型 HTTP 服务调用相同规则
        ↓
版本化模型 → Nuclio 在线部署
```

- MLRun UI：[项目列表](http://127.0.0.1:4000)。打开 `transaction-feature-demo` 查看特征集、特征向量、训练任务、模型和函数。
- 特征 HTTP：`http://127.0.0.1:18082/`
- 模型 HTTP：`http://127.0.0.1:18081/v2/models/order-classifier/infer`
- 配置入口：本目录 `config.json`；第一次运行复制到 PVC 的 `/home/jovyan/data/transaction-feature-demo/config.json`，后续运行保留该文件。

MLRun 中注册了历史特征集 `transaction-features` 和在线快照集 `transaction-features-online`。
后者使用 `_value` 字段保存静态结果，`transaction-serving` 向量映射回上面的业务特征名，避免与 MLRun 内置聚合状态的命名约定冲突。

## 时间语义

每条流水包含业务发生时间 `event_time`，系统自动写入接收时间 `received_at`。所有时间必须带时区，内部统一转换为 UTC。

窗口定义为 **`[as_of - window_seconds, as_of)`**。恰好发生在预测时点及之后的事件不进入该样本特征。

支持两种回溯口径：

| visibility | 数据条件 | 用途 |
| --- | --- | --- |
| `as_known`（默认） | 发生在时点前，且 `received_at <= as_of` | 复现当时系统能看到的信息；迟到和后来补录的数据不穿越 |
| `event_time` | 只限制发生时间 | 使用现在已收集到的明细重算历史；会包含后来补到的历史数据 |

不提供 `as_of` 时，使用数据库当前时间重新计算。**即使没有新流水到达，窗口也会正确滑动、旧事件也会过期。** Redis 保存最近一次计算快照；任意时点的准确结果由 HTTP 服务重算，不能把缓存快照当作自动随时钟更新的值。历史查询不会覆盖在线快照。

`event_id` 是幂等键：相同事件重试不重复计数，同 ID 不同内容返回 400，整批写入回滚。接收时间由服务端管理，HTTP 请求不能伪造 `received_at`。

## 特征定义

聚合定义保存在 JSON 配置中，由在线、离线共用；支持 `count/sum/avg/max`。

| 特征 | 粒度 | 事件 | 窗口 | 计算 |
| --- | --- | --- | --- | --- |
| `user_payment_count_1h` | 用户 | payment | 1 小时 | 次数 |
| `user_payment_sum_24h` | 用户 | payment | 24 小时 | 金额和 |
| `user_payment_avg_7d` | 用户 | payment | 7 天 | 平均金额 |
| `user_failed_count_24h` | 用户 | payment_failed | 24 小时 | 次数 |
| `user_refund_sum_7d` | 用户 | refund | 7 天 | 退款金额和 |
| `order_item_count_24h` | 订单 | item | 24 小时 | 明细行数 |
| `order_item_sum_24h` | 订单 | item | 24 小时 | 明细金额和 |
| `order_failed_count_24h` | 订单 | payment_failed | 24 小时 | 次数 |

未命中的计数、金额与均值返回 0。明细金额应在接入时统一货币和单位；示例不执行币种换算。用户/订单标识应在业务接入层校验其对应关系。

## 实时写入并返回聚合特征

```powershell
$event = @{
    event_id = [guid]::NewGuid().ToString()
    user_id = 'customer-001'
    order_id = 'purchase-001'
    event_type = 'payment'
    amount = 125.5
    event_time = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')
}
$body = @{
    user_id = 'customer-001'
    order_id = 'purchase-001'
    events = @($event)
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18082/ -ContentType application/json -Body $body
```

支持 `payment`、`payment_failed`、`refund`、`item`、`visit` 事件；单次最多 1000 条。实际日志接入时映射成 `event_id/user_id/order_id/event_type/amount/event_time`。只查询时不传 `events`。

仅查用户可以传 `{"user_id":"customer-001"}`，仅查订单可以传 `{"order_id":"purchase-001"}`；未指定粒度的特征为 0。只有同时提供两个标识的实时结果写入 MLRun 原生 Redis 快照，因为特征集的实体键是这两个标识的组合。

## 历史时点查询

```powershell
$body = @{
    user_id = 'customer-001'
    order_id = 'purchase-001'
    as_of = '2026-09-08T12:00:00+08:00'
    visibility = 'as_known'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18082/ -ContentType application/json -Body $body
```

历史查询不能同时提交新事件。首次示例的真实历史时点和实体保存在 `state.json` 的 `example_query` 中；避免把此处任意时间当成有历史数据的时间。

离线样本表每行包含 `user_id`、`order_id`、`as_of`，可以附加后续观察得到的 `label`。`functions.py` 的 `backfill` 作业按每行自己的截止时点计算并记录 `historical-features` 数据集；不会用今天的最新值替代过去的特征。原始事件和训练快照都保留，回溯不依赖 Redis 留存时间。

## 模型预测

```powershell
$body = @{ inputs = @(@{user_id='customer-001'; order_id='purchase-001'}) } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18081/v2/models/order-classifier/infer -ContentType application/json -Body $body
```

返回 V2 协议响应，其中 `outputs` 为预测标签。`1` 表示合成数据中的“后续需要跟进”，`0` 表示不需要。每个输入也可以带 `as_of` 做历史预测，或者传入按上表顺序排列的 8 个数值。

训练采用 240 个订单预测时点；只用时点前的信息构建特征，将时点后的模拟结果作为标签。前 80% 时间样本训练，后 20% 验证。模型带有 MLRun 特征向量引用、训练数据结构和指标。

## 安装、重启访问和验证

在仓库根目录执行：

```powershell
./hack/local/kind/mlops-demo/install.ps1
./hack/local/kind/mlops-demo/start-access.ps1
# 单独重新验证，不重复训练或替换服务配置：
./hack/local/kind/mlops-demo/install.ps1 -Stage verify
# 单独运行并保留离线回溯任务：
./hack/local/kind/mlops-demo/install.ps1 -Stage backfill
# 只有明确需要用本目录代码替换服务时，使用：
# ./hack/local/kind/mlops-demo/install.ps1 -Stage deploy-features -Redeploy
```

已有训练数据、模型和函数默认复用。特征定义改变后不能直接套用旧模型；脚本检测配置变化并停止，保留原项目。使用新的项目名、存储根目录和数据库 schema 构建下一版，或先设计显式的版本升级流程。

代码按内容哈希存入 `releases/<hash>/`，重复执行不会覆盖已完成的版本或首次部署的 `code/`。新部署的函数引用固定代码目录和 `config-revisions/<hash>.json` 配置副本；执行验证不会改变线上函数。首次导入会在写入第一条流水前保存 `seed-start.json`，中断重试使用相同时间和事件 ID，继续幂等导入。

数据库单元验证使用 PostgreSQL 临时表，不向业务表插入测试数据：

```powershell
# <hash> 使用安装脚本输出的 source release 值：
kubectl --context kind-mlrun -n mlrun exec deployment/jupyter-notebook -- python -m unittest discover -s /home/jovyan/data/transaction-feature-demo/releases/<hash> -v
```

## 持久化位置

| 内容 | 位置 |
| --- | --- |
| 流水明细、业务时间、接收时间 | 现有 PostgreSQL 的 `mlrun.transaction_feature_demo.events`，TimescaleDB PVC |
| 原生在线特征快照 | `mlrun-feature-redis`，独立 PVC，AOF 每秒落盘 |
| 项目配置、代码、样本时点、Parquet、验收结果 | `mlrun-data` PVC：`/home/jovyan/data/transaction-feature-demo/` |
| 特征集、向量、模型、训练运行记录 | MLRun API 数据库与共享数据卷 |
| 本地转发日志 | 仓库 `playground/access/transaction-*.log` |

Redis 固定为 7.4.11，版本依据 [Redis 7.4 发布说明](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisce-7.4-release-notes/)。Redis 只开放集群内部 Service，HTTP 转发只绑定本机 `127.0.0.1`。

这是可运行的本地完整示例。在线聚合采用带索引的明细查询，尚未做高吞吐压力测试、外部日志采集器接入或生产高可用部署；真实生产接入还需要业务字段映射、认证授权、容量与延迟验证。AOF 每秒落盘在宿主机断电时可能丢失最后约一秒的缓存写入，权威流水仍在 PostgreSQL，可重新计算。

本次调试保留了一条因旧 SQLite 孤立标签导致的失败训练记录。`recover_failed_run.py` 仅用于已确认的本机一次性问题，先备份数据库，再补回本次失败记录，不删除旧行，不属于正常安装流程。
