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

## 工具调用展示

关键目录：

- `packages/opencode/webgui/src/components/parts/ToolPart/`
- `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx`
- `packages/opencode/webgui/src/components/parts/ToolPart/utils.test.ts`
- `packages/opencode/webgui/src/lib/task-part.ts`
- `packages/opencode/webgui/src/lib/task-result.ts`

ToolPart 负责将 opencode 工具 part 转成 IDE 友好 UI：

- bash/read/write/edit/apply_patch 等工具专门展示。
- 工具卡片标题优先使用后端回写的 `state.title`，缺失时再按工具类型从 `input` 推导本地展示文案。
- `bash` 是单独适配点：运行中若还没有 `title`，前端先用 `input.description` 展示 `执行命令：...`。
- edit/write 后可展示 diff 或 patch 信息。
- 权限请求必须可见，不能因为折叠状态丢失授权入口。
- task 工具需要关联子任务状态。
- 对不认识的工具保留 generic output fallback。

`utils.tsx` 是标题与中文名规则的集中入口；`utils.test.ts` 负责保护这些展示语义，避免规则外溢。

当前被测试锁定的展示语义还包括：

- `skill` 标题要去掉 `Loaded skill:` / `Loading skill:` / `加载技能：` 前缀，避免重复。
- `todoread/todowrite` 在 output 是 todo JSON 列表时显示完成数/总数。
- `grep` 标题除 `pattern` 外还要补 `include`。
- `plan_enter` / `plan_exit` / `batch` / `question` / `websearch` / `codesearch` / `lsp` / `invalid` 等工具都有固定中文名。

## Diff、patch 与文件变更浏览

关键文件：

- `packages/opencode/webgui/src/components/DiffModal/`
- `packages/opencode/webgui/src/components/parts/PatchPart.tsx`
- `packages/opencode/webgui/src/components/FileChangesPanel.tsx`
- `packages/opencode/webgui/src/hooks/useMergedFileDiffs.ts`

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
- MCP/Skill 开关涉及前端、SDK client、后端 config 三处，不能只改 UI。
- 权限和问题事件仍由 opencode 底层判定，WebGUI 只负责展示与回复。
