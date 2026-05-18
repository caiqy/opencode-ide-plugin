# 会话、标签页与聊天体验

WebGUI 的核心体验是“IDE 内多会话聊天”。本项目在上游 opencode 会话能力之上增加了标签页、懒加载、历史分页、滚动稳态、草稿恢复、模型/Agent 选择恢复等插件化体验。

## 会话状态

关键文件：

- `packages/opencode/webgui/src/state/SessionContext.tsx`
- `packages/opencode/webgui/src/state/useSessionActivation.ts`
- `packages/opencode/webgui/src/state/switchSession.ts`
- `packages/opencode/webgui/src/state/sessionPaging.ts`

`SessionContext` 负责：

- 当前会话与会话列表。
- 创建、切换、重命名、删除。
- fork、revert、unrevert、redo、retry。
- 会话 busy/idle/reasoning/status/diff 状态。
- provider/model/agent/variant 选择与恢复。
- 过滤 subagent session，避免子任务污染主会话列表。

## 选择恢复链路

关键文件：

- `packages/opencode/webgui/src/lib/selection/selectionFromMessages.ts`
- `packages/opencode/webgui/src/state/useSessionActivation.ts`
- `packages/opencode/webgui/src/state/repo/selectionRepo.ts`
- `packages/opencode/webgui/src/state/MessagesContext.tsx`

切换会话时，WebGUI 不只读取全局模型配置。它会尝试恢复该会话最后一次用户发送时使用的 provider/model/agent/variant：

- 先加载当前会话最近一页消息。
- 从最近 user message 中提取选择信息。
- 如果最近页找不到且分页 cursor 存在，必要时通过 `scanOlder` 向前扫描更早消息，但不污染可见消息列表。
- 找不到历史选择时，再回落到 `selectionRepo` 或当前可用配置。
- 如果恢复的 provider/model/variant 已不可用，`SessionContext` 会自动调整并显示一次性提示。

这条链路是 IDE 多 tab 切换体验的关键：用户切回旧会话时，应尽量恢复当时的模型和 agent，而不是无条件套用最新全局选择。

## 多标签模型

关键文件：

- `packages/opencode/webgui/src/state/tabStore.ts`
- `packages/opencode/webgui/src/state/tabPolicy.ts`
- `packages/opencode/webgui/src/state/repo/tabsRepo.ts`
- `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`

标签页是 UI 层状态，不等于 opencode 会话生命周期。关闭 tab 不删除会话。

策略：

- 最多保留 `MAX_OPEN_TABS = 6`。
- 打开已有会话时激活已有 tab。
- 打开新会话时按策略淘汰旧 tab。
- `workspace:tabs:v1.active_tab` 是当前可恢复会话真源。
- 切换失败时通过 `switchSessionWithTabRollback` 回滚 UI 状态。

## 消息流与分页

关键文件：

- `packages/opencode/webgui/src/state/MessagesContext.tsx`
- `packages/opencode/webgui/src/lib/messagesStore.ts`
- `packages/opencode/webgui/src/lib/api/events.ts`
- `packages/opencode/webgui/src/components/MessageList/index.tsx`

设计目标：

- 首次只加载最近一页消息。
- 更早历史通过顶部“加载更多”显式触发。
- `MessagesContext` 保存分页真相，包括 cursor、loaded、complete，以及 latest/older 两段独立加载状态（`latest_loading`、`latest_error`、`older_loading`、`older_error`）。
- SSE 增量事件实时更新 message/part，不要求一次性加载完整历史。

消息模型还包含 WebGUI 扩展 part：

- optimistic user message：发送后先本地显示，等服务端事件回填。
- `session-error`：把会话错误合成为消息 part，避免错误只出现在控制台。
- `question` / permission 包装：把结构化交互请求挂到对应工具调用或当前会话。
- `WebguiPart` union：在 SDK part 基础上扩展 UI 专用类型。

关键文件：`packages/opencode/webgui/src/types/messages.ts`、`packages/opencode/webgui/src/lib/messagesStore.ts`。

加载失败和 abort 的收口规则：

- latest / older 请求如果因为 abort 结束，不应误标为已加载或错误状态。
- `ensureSession` 遇到已中止的 pending latest 时，应使用新的 AbortSignal 重新发起加载。
- 这条链路由 `MessagesContext.pagination.test.tsx` 直接锁定，避免会话切换或卸载时留下不可恢复的 loading/error 状态。

重要事件：

- `message.updated`
- `message.removed`
- `message.part.updated`
- `message.part.delta`
- `message.part.removed`
- `permission.asked/replied`
- `question.asked/replied/rejected`
- `session.status/idle/error/compacted/diff`

## 滚动稳态

WebGUI 避免全量 virtualization，采用更保守的聊天滚动模型：

- 底部实时区优先稳定。
- 更早历史加载只影响顶部。
- 历史加载后保持锚点，减少跳动。
- SSE 新消息只在用户贴底时自动滚到底。

近期稳定化约束：

- tail 区域 resize、工具输出展开、思考块展开和容器高度变化时，如果用户仍贴底，必须继续保持自动跟随。
- 用户通过滚轮、scrollbar 或键盘主动离开底部后，tail resize 不能把用户强行拉回底部。
- history 区高度变化只维护历史 anchor，不触发 tail 自动滚动；tail 区变化才驱动自动跟随。

相关代码主要在 `MessageList` 和滚动 hook 中。

## 输入与草稿

关键文件：

- `packages/opencode/webgui/src/components/MessageInput/`
- `packages/opencode/webgui/src/state/repo/draftRepo.ts`
- `packages/opencode/webgui/src/lib/dnd.ts`
- `packages/opencode/webgui/src/lib/keyboardHandler.ts`
- `packages/opencode/webgui/src/lib/fileUtils.ts`
- `packages/opencode/webgui/src/hooks/useMentionSearch.ts`
- `packages/opencode/webgui/src/hooks/useCommandSearch.ts`
- `packages/opencode/webgui/src/config/shortcuts.ts`

能力：

- Lexical 富文本输入。
- 文件、目录、agent、symbol、opened-files mention。
- `/command` 命令弹层与命令搜索。
- `/xxx` 只有精确命中 `/command` 真源列表才走 `session.command`；未命中时按普通消息发送，并保留前导 `/`。
- 图片、PDF、文本附件；`fileUtils` 负责 MIME 识别和 text attachment 归一化。
- `@文件` mention 的后端分流顺序固定为：目录 → PDF/图片 → 文本文件 → 其他二进制；其他二进制只保留路径引用，不自动 `Read`，也不应制造 `Session.Error`。
- 拖拽文件路径插入。
- 快捷短语，支持填入输入框、确认后发送、双击发送等模式。
- 会话维度草稿保存与恢复。
- 会话 busy、selection restore、加载错误时禁用或保护输入。
- abort 当前会话时，前端会先本地 reject 该 session 下仍未回答的 question，再调用 `session.abort`，避免 UI 残留阻塞问题卡片。

拖拽和键盘处理是 IDE 场景的兼容层：`dnd.ts` 解析 VSCode/JCEF 传入的 uri-list 与文件/目录信息；`keyboardHandler.ts` 在 iframe 中接管复制、粘贴、撤销、重做等组合键，避免宿主 webview 吞掉编辑器快捷键。

## 当前会话前台读取优先级

关键文件：

- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`
- `packages/opencode/webgui/src/state/useSessionActivation.ts`
- `packages/opencode/webgui/src/state/MessagesContext.tsx`
- `packages/opencode/src/session/summary-scheduler.ts`
- `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- `packages/opencode/src/server/routes/instance/session.ts`

规则：**当前正在激活和读取的会话，应优先于后台 summary/diff 调度。**

当前约束：

- `prompt.ts` / `processor.ts` 只负责 `markDirty(...)`。
- `SessionPrompt.loop(...)` 运行期间也会显式持有 foreground 保护。
- 前端会对 visible session 去重排序，并避免把当前激活 session 过早放入 background visible set；sync 失败会延迟重试并收敛到最新可见集。
- 后端在 `session.messages`、`session.diff` 等关键读取期间使用 foreground 保护。
- foreground 只影响后台 diff 启动时机，不改变 dirty 来源和 scheduler 状态机。

## 消息展示层

关键文件：

- `packages/opencode/webgui/src/components/MessageList/`
- `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`
- `packages/opencode/webgui/src/components/CodeBlock.tsx`
- `packages/opencode/webgui/src/components/TypingIndicator.tsx`

能力：

- Markdown 与 GFM 渲染。
- 代码块语法高亮、复制和折叠。
- reasoning、assistant meta、typing indicator。
- session error、revert banner、revert summary。
- 文本 part 中 mention 的显示与复制保真。
- 图片预览和常规附件展示。

近期展示契约：

- assistant meta 在存在 `completedAt` 时追加完整结束时间；`completedAt` 与 `interrupted` 可同时显示，非法时间戳不展示。
- `stream_timeout` 属于可重试的上游流内错误，后端会进入 retry 状态并通过 TypingIndicator 显示重试提示，而不是立即固化成最终错误卡片。
- 图片可以来自普通附件、Markdown generated image 路径或 tool result attachments；生成图片的模型上下文以 tool attachment 为准，保存到本地文件不改变模型上下文。

## 顶部会话工作台

关键文件：

- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/SessionList.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`
- `packages/opencode/webgui/src/components/CommandPalette.tsx`
- `packages/opencode/webgui/src/components/KeyboardShortcutsHelp.tsx`

`CompactHeader` 是 WebGUI 的会话工作台：它承载 tab bar、会话历史搜索、批量/单项会话操作、分享、主题、设置、状态面板、检查更新和重启入口。命令面板与快捷键帮助为这些高频动作提供键盘入口。

## 辅助 hooks

关键文件：

- `packages/opencode/webgui/src/hooks/useSessionUsage.ts`
- `packages/opencode/webgui/src/hooks/useMergedFileDiffs.ts`
- `packages/opencode/webgui/src/hooks/useProviderStore.ts`
- `packages/opencode/webgui/src/hooks/useOpenFile.ts`

职责：

- `useSessionUsage` 根据消息和模型信息估算 token、成本与 context limit 展示。
- `useMergedFileDiffs` 合并 session diff 与工具 part 中的文件变更，供 diff 入口使用。
- `useProviderStore` 缓存 provider/model 名称和可用性，减少 selector 直接依赖原始响应。
- `useOpenFile` 优先通过 IDE bridge 打开文件，浏览器开发模式下再 fallback。

## IDE 场景适配

- Host 可推送 `insertPaths` / `pastePath`，直接写入输入框。
- 工具写入文件后，`MessagesContext` 调用 `reloadPath` 通知 IDE 刷新。
- 打开文件通过 bridge，而不是普通浏览器链接。

## 维护注意点

- `SessionContext` 与 `MessagesContext` 分工要清晰：前者管会话元数据，后者管消息内容与分页。
- 不要把 subagent session 混入主会话历史列表。
- retry/revert/redo 依赖上游会话语义，修改前需确认 SDK 返回结构。
- slash 补全和真实发送必须共用同一份 `/command` 真源。
- 不要把 PDF/图片误归到普通二进制，也不要让二进制路径重新触发无意义 `Read`。
- 修改会话激活、历史分页或 diff 状态链时，要同时检查前端 visibility、后端 foreground 保护和 `SessionSummaryScheduler`。
