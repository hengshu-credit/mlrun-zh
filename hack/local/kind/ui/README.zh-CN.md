# MLRun UI 中英双语

本地镜像 `mlrun/mlrun-ui:1.13.0-rc7-local.10` 在固定的 MLRun UI 源码版本
`c4235698cba093958c02281cd20dbe0ab380230e` 上加入简体中文和英文，并保留 CE 工作流权限修复。

## 使用

直接访问 `http://127.0.0.1:4000/` 会跳转到 `/mlrun/projects`。入口 HTML 和运行时配置返回 `Cache-Control: no-store`，避免更新镜像后继续加载旧版 UI。
从旧版升级且浏览器已缓存原始入口时，访问一次 `http://127.0.0.1:4000/ui-refresh` 即可清除本站 HTTP 缓存并进入新版；语言偏好、侧栏宽度和其他本地存储不受影响。
部署后可运行 `node hack/local/kind/ui/verify-entry.cjs` 检查根地址跳转、缓存响应头、当前版本资源、深层链接及 API 代理。

页面顶栏的“简体中文 / English”下拉框可即时切换语言。首次访问使用浏览器的首选语言：中文使用简体中文，其余使用英文。
选择保存在当前站点的 `localStorage`，刷新和再次访问时保留；同源其他标签页会同步选择。浏览器禁止存储时仍可在当前页面切换。
语言切换不重载页面，不清空表单输入。项目名、用户描述、标签值、文件路径、代码、日志和后端返回的错误详情保持原文。

覆盖 MLRun 自身的导航、项目、作业与工作流、函数、产物、特征库、模型监控、设置、公共表单控件、校验提示和默认操作反馈。
Nuclio 的实时函数与 API 网关直接内嵌在 MLRun 内容区，浏览器保持在 `http://127.0.0.1:4000/`。入口分别为 `/mlrun/projects/<项目>/real-time-functions` 和 `/mlrun/projects/<项目>/api-gateways`，支持刷新、前进后退和侧栏项目切换。
iframe 加载 `nuclioUiUrl` 指向的现有 Nuclio 页面（本地为 8070 端口），沿用其现有样式、交互和[双语覆盖层](../nuclio-ui/README.zh-CN.md)，不再为内嵌单独调整 Nuclio。初次打开时传递当前语言；为保留未保存的 Nuclio 表单，外层切换语言不会重载 iframe，内页仍可使用自身语言选择器。Nuclio 服务和 8070 端口转发需保持可用。Jupyter、Grafana 和外部文档保持各自原有界面。

## 品牌与侧栏

Header 的“文档”和“函数中心”在 MLRun 内容区内嵌对应官方网站，不再默认打开新标签页。全局入口为 `/mlrun/documentation` 和 `/mlrun/function-hub`；从项目内进入时使用 `/mlrun/projects/<项目>/documentation` 和 `/mlrun/projects/<项目>/function-hub`，保留项目侧栏。支持直接访问、刷新和浏览器前进后退。外层语言切换只更新导航和 iframe 标题，不重载正在阅读的网页，也不改写官方网站内容。

Header 和浏览器标签页使用与天枢决策引擎相同的 hscredit Logo，中文标语为“天工开物，枢衡定策”，英文标语为“Crafting Innovation, Guiding Decisions”，随语言选择即时切换。产品名称保留 MLRun；移除 GitHub、Slack 入口。
网站使用阿里妈妈方圆体，字体和 Logo 从天枢前端复制到 `i18n/assets/` 并随构建打包，不依赖天枢服务或外部字体网络。代码和日志的等宽展示保留。

侧栏采用天枢的深蓝配色，默认宽度 220px，可拖拽右侧边界调整至 64–320px；低于 168px 时只显示图标，否则显示图标和文字。
宽度保存在当前站点的 `localStorage`，不可用时仍可调整。侧栏没有折叠按钮，也不会因鼠标经过而改变宽度。
多级菜单按侧栏状态触发：展开时点击菜单向下展开子项，再次点击收起，悬浮不会展开；折叠时悬浮图标在右侧显示子菜单，移入浮窗可继续选择，移出图标和浮窗后延迟 160ms 关闭。选择子项或点击外部也会关闭浮窗。箭头随展开状态旋转，当前子项保持选中高亮；展开状态下滚动或点击内容区不收起子菜单。拖动侧栏跨越折叠阈值时清理原有浮窗。
保留 MLRun 原有项目切换和路由，Nuclio 两个入口为站内内嵌路由。键盘可用方向键打开和选择子项、Esc 或左方向键关闭并返回父菜单；聚焦侧栏边界后可用左右方向键调整宽度、Home/End 调整到最小/最大宽度。

`apply-shell.cjs` 负责接入 Header、页面侧栏和全局样式；`TianshuSidebar.jsx`、`SidebarEntry.jsx` 和 `tianshu-shell.css` 为可维护的覆盖层源文件。

## 构建与部署

从仓库根目录运行，需要 Docker、kind、Git、npm 和 Node.js 22 或 24：

```powershell
./hack/local/kind/build-ui.ps1
kubectl --context kind-mlrun -n mlrun set image deployment/mlrun-ui mlrun-ui=mlrun/mlrun-ui:1.13.0-rc7-local.10
kubectl --context kind-mlrun -n mlrun rollout status deployment/mlrun-ui --timeout=180s
```

`install-full.ps1` 也会构建并使用此镜像。构建脚本验证上游 ZIP 的 SHA256、应用工作流补丁和双语覆盖层、运行回归测试与 lint、构建前端，再将镜像导入 kind。
临时源码及构建产物保存在被 Git 忽略的 `playground/ui-release/`。
Node.js 26 的全局 Web Storage 与当前 jsdom 测试环境冲突；脚本在可用时选择 Codex 自带的 Node.js 24，也可以手动指定：

```powershell
./hack/local/kind/build-ui.ps1 -NodePath 'C:/tools/node24/node.exe'
```

## 翻译维护

- `i18n/en.json`、`i18n/zh-CN.json`：以英文原文为键的可编辑目录。新增文案时同步维护两份目录，保留 `{0}`、`{1}` 等插值参数。
- `i18n/locale.js`：语言偏好、订阅和翻译回退。未登记的文案回退到英文原文。
- `i18n/transform.cjs`、`vite-plugin.cjs`：在编译时转换源码中明确的展示文案；不扫描或改写 DOM，不调用远程翻译服务。协议 ID、路由、比较值、表单值不参与翻译。
- `i18n/state.js`、`datetime.js`、`validation.js`：状态展示、日期与规则描述适配；原始状态值、时区含义和校验逻辑不变。
- `apply-bilingual.cjs`：接入顶栏和构建插件，以及少数使用应用内字段描述的展示组件。上游接入点变化时会报错。

在准备好的 UI 源码目录中运行以下命令可提取候选文案，输出带源文件位置的 `i18n-messages.json`。提取结果需要人工判断，技术名称、示例路径和用户数据不可批量翻译。

```powershell
node src/i18n/extract.cjs
node node_modules/vitest/vitest.mjs run src/i18n
```

测试检查目录及插值完整性、浏览器偏好、存储受限、切换后的表单状态、公共控件、日期、原始状态/校验值，以及语言切换不会重新触发下载等副作用。
