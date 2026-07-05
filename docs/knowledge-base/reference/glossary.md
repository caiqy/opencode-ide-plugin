# 术语表

本页收集 OpenCode IDE Plugin 知识库读者需要先解码的领域术语。专有名词保留英文；上下文链接相对本文件所在的 `reference/` 目录。

## WebGUI 与宿主集成

| 术语 | 含义 | 上下文 |
|------|------|--------|
| `caiqy.opencode-ui` | VSCode Marketplace Unique Identifier，由 `publisher=caiqy` 和 `name=opencode-ui` 组成；JetBrains 当前技术插件 ID 也使用同一标识。旧 `qtkj.opencode-ui` 只作为历史迁移标识。 | [business/packaging-release.md](business/packaging-release.md)、[repositories/hosts-vscode-plugin.md](repositories/hosts-vscode-plugin.md) |
| IDE Bridge | WebGUI 与 VSCode/JetBrains 宿主之间的自定义通信层，用 token、POST 和 SSE 连接补齐浏览器环境无法直接完成的 IDE 能力。 | [business/ide-bridge.md](business/ide-bridge.md) |
| JCEF | JetBrains 侧承载 WebGUI 的浏览器/webview 技术边界，与 VSCode webview 同属宿主承载层。 | [business/host-webview-integration.md](business/host-webview-integration.md)、[capabilities-index.md](capabilities-index.md) |
| `OPENCODE_UI_VERSION` | VSCode backend 启动时注入的环境变量，用宿主真实插件版本生成 `opencode-ui/<version>` user agent；空版本不注入并清理继承的 stale 值。 | [business/upstream-compatibility.md](business/upstream-compatibility.md)、[repositories/hosts-vscode-plugin.md](repositories/hosts-vscode-plugin.md) |
| `restartMode` (`window`/`ide`) | IDE Bridge `connected` 事件中的宿主重启模式：`window` 表示 VSCode 重载窗口，`ide` 表示 JetBrains 重启 IDE。 | [business/ide-bridge.md](business/ide-bridge.md) |
| VersionGate | WebGUI 展示层的版本门禁组件，用宿主/后端版本信息驱动更新提示和阻断逻辑。 | [business/version-update.md](business/version-update.md)、[capabilities-index.md](capabilities-index.md) |
| WebGUI | 本 fork 提供的浏览器/IDE webview 聊天界面，包含会话标签、状态面板、设置、更新提示等插件主体体验，并由 server 侧 `/app` 本地托管。 | [business/embedded-webgui-serving.md](business/embedded-webgui-serving.md)、[repositories/packages-opencode.md](repositories/packages-opencode.md) |

## 状态与项目身份

| 术语 | 含义 | 上下文 |
|------|------|--------|
| non-git project identity | 非 Git 普通目录按实际目录派生稳定 project id，不再坍缩到 global project，避免 tabs、drafts、selection 和 session list 串项目。 | [business/project-identity.md](business/project-identity.md)、[business/scoped-storage.md](business/scoped-storage.md)、[business/upstream-compatibility.md](business/upstream-compatibility.md) |
| scoped storage (`global`/`workspace`/`mem`) | WebGUI UI 状态的三类作用域：`global` 跨工作区共享，`workspace` 保存当前项目恢复状态，`mem` 是 Host session 内瞬态状态。 | [business/scoped-storage.md](business/scoped-storage.md) |
| 快捷短语 (quick phrase) | MessageInput 的 preset/custom 快捷输入能力，支持隐藏、排序、执行模式以及双击发送或回填。 | [business/message-input.md](business/message-input.md)、[capabilities-index.md](capabilities-index.md)、[business/scoped-storage.md](business/scoped-storage.md) |

## 工具、子任务与图片

| 术语 | 含义 | 上下文 |
|------|------|--------|
| `generate_image` / generated-image 路由 | fork 专用图片生成工具会把图片写入项目 `.opencode/generated-images/`，attachment 通过 `relativePath` 和 generated-image 专用路由给 WebGUI 预览、保存和后续引用。 | [business/generated-image.md](business/generated-image.md)、[repositories/packages-opencode.md](repositories/packages-opencode.md)、[business/upstream-compatibility.md](business/upstream-compatibility.md) |
| `STREAMABLE_TOOLS` | 后端流式工具输入白名单，目前覆盖 `write`、`edit`、`apply_patch`；新增写入类工具时必须同步前端 mirror。 | [business/tool-rendering.md](business/tool-rendering.md)、[capabilities-index.md](capabilities-index.md) |
| subtask drawer (子任务抽屉) | task 工具可打开的右侧抽屉，独立展示子任务消息、支持宽度拖拽，并在父消息工具卡片显示 permission/question 阻塞态。 | [business/subtask-drawer.md](business/subtask-drawer.md)、[repositories/packages-opencode.md](repositories/packages-opencode.md) |
| ToolPart | WebGUI 中负责渲染 opencode 工具 part 的组件族，把 bash/read/write/edit/apply_patch/task/todo/question 等工具转成 IDE 友好的卡片。 | [business/tool-rendering.md](business/tool-rendering.md)、[repositories/packages-opencode.md](repositories/packages-opencode.md) |
| WebguiPart | WebGUI 消息流使用的 part union，在 SDK part 基础上扩展 UI 专用类型，用于消息上下文和渲染分发。 | [business/session-chat.md](business/session-chat.md) |
| 流式工具预览 | 对 write/edit/apply_patch 等大输入工具，从 SSE chunk 逐步构建文件名、行数和内容预览，避免完成前只看到空工具卡。 | [business/tool-rendering.md](business/tool-rendering.md)、[capabilities-index.md](capabilities-index.md)、[repositories/packages-opencode.md](repositories/packages-opencode.md) |

## 设置、Provider、Agent 与运行时开关

| 术语 | 含义 | 上下文 |
|------|------|--------|
| Agent 配置热重载 | 轻量 Agent 默认配置变更（如 model/variant/system prompt）不触发整个 Instance dispose，而是热重载受影响服务并即时生效。 | [business/agent-config.md](business/agent-config.md)、[business/upstream-compatibility.md](business/upstream-compatibility.md) |
| config overlay/patch | WebGUI 的 MCP、Skills、工具开关和配置文件打开等能力依赖的项目配置 patch/overlay 语义，是上游同步时必须保留的下游适配。 | [business/upstream-compatibility.md](business/upstream-compatibility.md) |
| Provider 设置 | 设置面板中的 Provider 配置页，维护接口地址、API key、模型白名单以及远程覆盖合并。 | [business/provider-settings.md](business/provider-settings.md)、[capabilities-index.md](capabilities-index.md) |
| Skill runtime overlay | `PATCH /skill/:name/enabled` 写入项目配置后，还设置同实例 runtime skill permission overlay，使 Skills 启停不重建 Instance 也能立即影响下次 agent 行为。 | [business/status-panel.md](business/status-panel.md)、[repositories/packages-opencode.md](repositories/packages-opencode.md)、[business/upstream-compatibility.md](business/upstream-compatibility.md) |

## 会话、调度与安全边界

| 术语 | 含义 | 上下文 |
|------|------|--------|
| foreground 读取保护 | 当前会话首屏读取、历史分页扫描和当前会话 diff 读取期间，后台 summary/diff 调度不能抢占前台读取。 | [business/foreground-read-priority.md](business/foreground-read-priority.md)、[business/upstream-compatibility.md](business/upstream-compatibility.md) |
| SessionSummaryScheduler | 后端统一处理后台 diff/summary 调度的 session 组件；`prompt.ts` 和 `processor.ts` 只负责 `markDirty(...)`。 | [business/foreground-read-priority.md](business/foreground-read-priority.md)、[business/upstream-compatibility.md](business/upstream-compatibility.md) |

## 发布与维护流程

| 术语 | 含义 | 上下文 |
|------|------|--------|
| build-vsix | Windows 版 VSCode 插件 `.vsix` 快速打包流程。知识库读者遇到 VSCode 打包或发布文档时可把它理解为本仓库的本地 VSIX 打包捷径。 | [business/packaging-release.md](business/packaging-release.md)、[../../../memory/glossary.md](../../../memory/glossary.md) |
| gradlew.bat 命令规则 | Windows/PowerShell 中所有 `gradlew.bat` 命令默认追加 `--no-daemon --console=plain`；如遇 daemon 卡住或文件锁，先 `./gradlew.bat --stop`。 | [business/packaging-release.md](business/packaging-release.md)、[../../../memory/glossary.md](../../../memory/glossary.md) |
| 版本规则 `YY.M.DDNN` | 仓库通用版本格式：年份后两位、月份不补零、`DDNN` 为日期乘 100 加当天序号；跨天后日期段必须更新，当天序号重置为 `00`。 | [business/packaging-release.md](business/packaging-release.md)、[../../../memory/glossary.md](../../../memory/glossary.md) |
