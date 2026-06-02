# 子任务、工具、MCP 与 Skills

本项目在 WebGUI 中强化了 Agent 子任务、工具调用、MCP server/tool、Skills 的可视化与控制能力。这些能力底层依赖 opencode，但 UI 和交互是插件主体的重要部分。

## 子任务抽屉

关键文件：

- `packages/opencode/webgui/src/state/SubtaskDrawerContext.tsx`
- `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`
- `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.tsx`
- `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`

能力：

- task 工具可打开右侧子任务抽屉。
- 子任务消息独立展示，不切换父会话 `currentSession`。
- 打开抽屉时补拉子会话历史，后续复用 SSE 更新。
- 抽屉支持局部宽度拖拽，但不持久化。
- 子任务处于 permission/question 阻塞时，在父消息工具卡片上显示阻塞状态。
- 支持实验性后台子 Agent（background subagent）：通过 `task_status` 工具跟踪子任务执行状态，不阻塞父会话流。

## 工具调用展示

关键目录：

- `packages/opencode/webgui/src/components/parts/ToolPart/`
- `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx`
- `packages/opencode/webgui/src/components/parts/ToolPart/utils.test.ts`
- `packages/opencode/webgui/src/lib/task-part.ts`
- `packages/opencode/webgui/src/lib/task-result.ts`

ToolPart 子组件清单：

- `ToolPart/BashTool.tsx` — bash 工具展示（命令执行、输出、退出码）
- `ToolPart/EditTool.tsx` — 文件编辑展示（edit/apply_patch）
- `ToolPart/ReadTool.tsx` — 文件读取展示
- `ToolPart/TaskTool.tsx` — 子任务工具展示
- `ToolPart/TodoTool.tsx` — 待办工具展示（todoread/todowrite）
- `ToolPart/QuestionTool.tsx` — 提问工具展示
- `ToolPart/ToolHeader.tsx` — 工具卡片头部（标题、图标、折叠/展开）
- `ToolPart/ToolDetails.tsx` — 工具详情区（折叠内容区外壳）
- `ToolPart/ToolImageAttachments.tsx` — 图片附件展示（缩略图网格）
- `ToolPart/GenericOutput.tsx` — 通用输出回退（未知工具类型）
- `ToolPart/ErrorDisplay.tsx` — 错误展示
- `ToolPart/PatchInfo.tsx` — 补丁信息（文件路径、hunk 数等摘要）
- `ToolPart/PermissionBanner.tsx` — 权限请求横幅
- `ToolPart/TimingInfo.tsx` — 耗时信息（运行时长展示）
- `ToolPart/usePartialToolInput.ts` — 流式输入解析 hook（从 SSE chunk 逐步构建 input）

配套 lib 辅助模块：

- `packages/opencode/webgui/src/lib/task-part.ts` — 工具 part 类型解析（part 分发与状态判定）
- `packages/opencode/webgui/src/lib/task-result.ts` — 工具结果类型处理（output 解析与结构化）
- `packages/opencode/webgui/src/lib/partial-tool-input.ts` — 流式工具输入解析（从原始 SSE 文本构建 input JSON）

ToolPart 负责将 opencode 工具 part 转成 IDE 友好 UI：

- bash/read/write/edit/apply_patch 等工具专门展示。
- 工具卡片标题优先使用后端回写的 `state.title`，缺失时再按工具类型从 `input` 推导本地展示文案。
- `bash` 是单独适配点：运行中若还没有 `title`，前端先用 `input.description` 展示 `执行命令：...`。
- edit/write 后可展示 diff 或 patch 信息。
- 权限请求必须可见，不能因为折叠状态丢失授权入口。
- task 工具需要关联子任务状态。
- 对不认识的工具保留 generic output fallback。
- `task_status` — 查询后台子任务执行状态（实验性）

`utils.tsx` 是标题与中文名规则的集中入口；`utils.test.ts` 负责保护这些展示语义，避免规则外溢。

当前被测试锁定的展示语义还包括：

- `skill` 标题要去掉 `Loaded skill:` / `Loading skill:` / `加载技能：` 前缀，避免重复。
- `todoread/todowrite` 在 output 是 todo JSON 列表时显示完成数/总数。
- `grep` 标题除 `pattern` 外还要补 `include`。
- `plan_enter` / `plan_exit` / `batch` / `question` / `websearch` / `codesearch` / `lsp` / `invalid` 等工具都有固定中文名。

## 其他 Part 组件

除 ToolPart 外，消息流中还有以下 Part 组件，各自处理不同消息体类型：

- `packages/opencode/webgui/src/components/parts/AgentPart.tsx` — Agent 切换/展示。当 session 中 agent 发生变更时，在消息流中插入 Agent 指示条，标明当前生效的 agent。
- `packages/opencode/webgui/src/components/parts/FilePart.tsx` — 文件操作展示。处理 `file` 类型的 part（如文件打开、worktree 变更），展示文件路径和操作摘要。
- `packages/opencode/webgui/src/components/parts/RetryPart.tsx` — 重试展示。当用户或系统触发消息重试时，显示重试分割线和状态提示。
- `packages/opencode/webgui/src/components/parts/SnapshotPart.tsx` — 快照展示。在消息流中插入快照分割线，分隔不同轮次的上下文快照。
- `packages/opencode/webgui/src/components/parts/ImagePreview.tsx` — 图片缩略图预览。独立于 ToolImageAttachments 的通用图片缩略图组件，用于非 generate_image 场景的图片展示。
- `packages/opencode/webgui/src/components/parts/PatchPart.tsx` — Patch 消息展示。处理 `patch` 类型的顶层 part，展示 apply_patch 产生的补丁摘要和 diff 入口。

这些组件与 ToolPart 同级，通过 `packages/opencode/webgui/src/components/MessageList.tsx` 中的 part 类型分发统一渲染。

## 图片生成工具与预览

`generate_image` 是本 fork 为 IDE/WebGUI 场景保留的关键工具能力。它的展示链路不是普通文本 output，而是：

```text
generate_image provider result
  -> .opencode/generated-images project file
  -> ToolStateCompleted.attachments[]
  -> ToolImageAttachments 缩略图网格
  -> ImageOverlay 预览 / 保存
```

当前契约：

- 工具名 image_generation 显示为“模型内置生图”（模型原生生图），generate_image 显示为“图片生成”（fork 专用工具），两者 UI 显示名和目标不同。
- 工具 output 保留 `已生成 N 张图片：` 摘要，不把 `Image #N filename` 拼成重复标题。
- 图片编号只按图片附件计数，前置 text attachment 不导致跳号。
- attachment 存在 `relativePath` 时，预览和缩略图都使用 generated-image 专用路由；旧 data URL 图片仍可显示。
- `ImageOverlay` 支持保存、缩放、重置、适应窗口、滚轮缩放、拖拽平移、Esc 关闭；点击图片外阴影/空白区域关闭，点击图片本体或工具栏不关闭。

保存链路通过 WebGUI `saveImage()` 分流：插件环境走 IDE bridge `saveImage`，普通浏览器环境回退到下载链接。

## Diff、patch 与文件变更浏览

关键文件：

- `packages/opencode/webgui/src/components/DiffModal/`
- `packages/opencode/webgui/src/components/parts/PatchPart.tsx`
- `packages/opencode/webgui/src/components/FileChangesPanel.tsx`
- `packages/opencode/webgui/src/hooks/useMergedFileDiffs.ts`

DiffModal 子组件：

- `packages/opencode/webgui/src/components/DiffModal/DiffHeader.tsx` — Diff 弹窗头部（文件列表标签与操作按钮）
- `packages/opencode/webgui/src/components/DiffModal/DiffNavigation.tsx` — 文件间导航（上一个/下一个文件切换）
- `packages/opencode/webgui/src/components/DiffModal/DiffViewer.tsx` — 差异内容展示（Monaco diff editor 集成）
- `packages/opencode/webgui/src/components/DiffModal/utils.ts` — Diff 工具函数（路径解析、diff 数据格式化等）
- `packages/opencode/webgui/src/components/DiffModal/hooks/useDiffData.ts` — Diff 数据 hook（服务端 diff 数据获取与缓存）

能力：

- `PatchPart` 展示 apply_patch 类工具产生的 patch 信息。
- `DiffModal` 支持多文件 diff 浏览、文件间导航和变更内容查看。
- `FileChangesPanel` 在输入区底部或会话辅助区域提示当前会话涉及的文件变更。
- `useMergedFileDiffs` 将服务端 `session.diff` 与消息流中的工具变更合并，避免用户只能从单个 tool part 进入 diff。

维护时要注意：diff 展示横跨消息 part、session diff、文件打开和 IDE reload；修改工具 schema 或 session diff 结构时，必须同时检查这些入口。

## Server 状态分区

关键文件：

- `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`
- `packages/opencode/webgui/src/lib/api/events.ts`
- `packages/opencode/webgui/src/lib/ideBridge.ts`
- `packages/opencode/webgui/src/state/ProjectContext.tsx`

Server tab 是状态面板的基础分区，用来快速判断 WebGUI 是否处在可用的 IDE 插件运行态。截图中的信息来自这里：

- `SSE 连接`：展示 WebGUI 到 opencode `/event` 事件流的连接状态，例如 `connected`、`connecting`、`disconnected`。
- `IDE bridge`：展示 WebGUI 到宿主插件本地 bridge 的状态，例如 `ready` 或未连接。
- `路径`：展示当前 opencode 实例 / 项目的工作目录，来自 path/project 状态。
- `后端地址`：优先展示 Vite dev 注入的 `__OPENCODE_BACKEND_URL__`，未注入时回退当前 origin。这个字段用于区分“WebGUI 当前页面地址”和“实际 opencode backend 目标”，本地多端口联调时尤其重要。

它的定位是“环境健康检查”，不是具体业务功能。用户遇到消息不刷新、文件无法打开、路径不对、MCP/LSP 状态异常时，应先看 Server 分区判断是哪条链路断了。

维护时要注意：Server 分区的数据来自多个源头，不能只看一个 API。SSE 状态来自 `events.ts`，IDE bridge 状态来自 `ideBridge.ts`，路径/project 信息来自 `ProjectContext` 和 path API；`useStatusPopoverData.ts` 负责把这些来源聚合成状态面板可展示的数据。

## MCP 状态与开关

关键文件：

- `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`
- `packages/opencode/webgui/src/lib/api/sdkClient.ts`

状态面板中的 MCP 能力：

- 展示 MCP server 列表与连接状态。
- server 级 enable/disable。
- tool 级 enable/disable。
- 工具列表可折叠。
- 刷新与 busy/loading 状态。

底层适配：

- WebGUI 调用 `sdk.mcp.tools`、`sdk.mcp.setEnabled`、`sdk.mcp.setToolEnabled`。
- 后端通过 config/MCP patch 让这些选择在后续请求中生效。
- wiki 不展开 MCP 内部实现，只记录 UI 入口和下游适配边界。

## Skills 开关

Skills 与 MCP 类似，属于项目能力开关，但语义不同：

- Skills 状态来自 opencode 后端 `GET /skill` 返回的 effective `enabled`，这是 WebGUI 展示开关状态的唯一权威来源。
- WebGUI 在状态面板中展示并允许启停。
- 实际写回通过 `PATCH /skill/:name/enabled` 完成：先写 `permission.skill` 到项目配置，再设置 runtime skill permission overlay，使同实例立即生效且不重建 Instance。
- 前端不自行解释 `permission.skill`、wildcard、`?` 或平台大小写规则，避免 IDE 本地平台与 opencode 后端平台不一致时出现 UI/实际权限漂移。
- Skills 刷新使用独立竞态版本号；toggle 后只使旧的 Skills 请求失效，不取消并发 refreshAll 中 Server/MCP/LSP/Plugins 的提交。

关键文件：

- `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`
- `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- `packages/opencode/src/server/routes/instance/index.ts`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/permission/index.ts`
- `packages/opencode/src/skill/index.ts`

## LSP 与 Plugins

状态面板也展示 LSP、plugins 等运行时信息。它们主要是可观测性入口，不承担复杂编辑功能。

设计约束：

- Header 局部适配层统一聚合状态。
- 各 tab 不各自拼接真相，避免状态来源分散。
- 首版重点是“看得到、能刷新、能定位问题”。

## 维护注意点

- 工具 part schema 变化会影响 ToolPart、task 抽屉、文件刷新逻辑。
- 调整工具标题来源时，要同时检查 `state.title` 优先级、运行中 fallback 与 completed 阶段一致性；当前仅 `bash` 使用 `input.description` 提前展示，不要默认扩散到其他工具。
- 新增工具类型时，必须同时更新 ToolPart 子组件映射（`index.tsx` 中的 tool-type → component 分发）和 `utils.tsx` 中文名表，否则会出现空白标题或无专用 UI。
- 调整工具卡片头部时，注意 `state.title` 优先级规则：后端回写的 `state.title` 优先级最高，前端本地推导仅在后端未提供时生效。修改 `ToolHeader.tsx` 的标题逻辑时要保证这一优先级不降级。
- MCP/Skill 开关涉及前端、SDK client、后端 config 三处，不能只改 UI。
- 权限和问题事件仍由 opencode 底层判定，WebGUI 只负责展示与回复。
