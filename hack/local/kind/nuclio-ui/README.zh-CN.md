# Nuclio 中英文界面覆盖层

此目录为本地 kind 环境构建 Nuclio 1.17.6 双语界面，沿用上游 AngularJS 和 i18next。固定源码提交 `4c28a83e688468da32d85ab07b76adc7a8e1a6b1`、下载校验和、npm lock 和官方 dashboard 镜像摘要；仅替换镜像中的静态界面文件。

在仓库根目录运行：

```powershell
./hack/local/kind/build-nuclio-ui.ps1
kubectl --context kind-mlrun -n mlrun set image deployment/nuclio-dashboard nuclio-dashboard=mlrun/nuclio-dashboard:1.17.6-local.1
kubectl --context kind-mlrun -n mlrun rollout status deployment/nuclio-dashboard --timeout=60s
./hack/local/kind/start-access.ps1
```

构建脚本支持 `-ClusterName`、`-Proxy`、`-NodePath`、`-KindPath`，会执行回归测试和上游 ESLint/生产构建，然后将镜像加载到 kind。重新构建同一镜像标签后，使用 `kubectl rollout restart deployment/nuclio-dashboard -n mlrun --context kind-mlrun` 更新已有 Pod。Pod 替换后需重新建立 8070 端口转发。完整安装脚本会在 Helm 安装前调用此构建脚本。

访问 `http://127.0.0.1:8070/projects?lng=zh-CN` 或 `?lng=en`。顶部返回主页与语言选择器左右排列。语言选择优先级为有效 `lng` 参数、本端口保存的 `mlrun.ui.locale`、浏览器首选语言；参数读取后移除，刷新不会覆盖之后的选择。返回 MLRun 使用传入或会话保存的 HTTP(S) `origin`，并携带当前语言；未提供时使用本地 4000 端口。内嵌时，返回主页和面包屑返回 MLRun 均在最外层窗口导航，避免在 iframe 内重复加载 MLRun 菜单。

`i18n/zh-CN/common.json` 和 `functions.json` 覆盖上游全部 954 个词条。`local.json` 补充上游硬编码控件文案，以英文原文作为键。`control-labels.cjs` 只在明确列出的 Nuclio 控制器中接入展示字段，保留 API 标识符、HTTP 方法、用户名称、源代码、响应和服务端日志。新增翻译后，构建会检查键覆盖、空值、意外英文回退和插值参数一致性。

切换语言沿用上游路由重载。存在未部署的函数更改或待应用的触发器、卷更改时，先使用原生确认弹窗；取消后保留编辑和原语言。第三方 Monaco 编辑器内部菜单、原始服务端错误、用户提供的代码或数据不属于翻译目录。Windows 构建保留原始图片，跳过不必要的本地图像压缩二进制；不改变图片内容。
