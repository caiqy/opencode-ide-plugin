# 能力：子任务抽屉

> **象限**：Reference（能力参考）
> **能力编号**：C3（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色                  | 文件                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| 抽屉状态上下文        | `packages/opencode/webgui/src/state/SubtaskDrawerContext.tsx`                  |
| 抽屉壳层与拖拽宽度    | `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskDrawer.tsx`      |
| 子会话消息列表        | `packages/opencode/webgui/src/components/SubtaskDrawer/SubtaskMessageList.tsx` |
| task 工具卡内容       | `packages/opencode/webgui/src/components/parts/ToolPart/TaskTool.tsx`          |
| task 工具入口与阻塞态 | `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`             |

## 意图

让父会话里的 `task` 工具可以查看子会话执行过程，而不切换当前主聊天会话。用户能在右侧抽屉观察子 agent 的消息、工具调用、permission/question 阻塞。

## 行为契约

- `SubtaskDrawerContext` 只保存当前抽屉 `isOpen/sessionId/title/subagentType/parent`，没有持久化宽度或历史栈（`SubtaskDrawerContext.tsx` 第 17-25 行、第 35-72 行）。
- `openSubtaskDrawer` 会覆盖当前抽屉目标；`closeSubtaskDrawer` 会清空 session、title、subagentType 与 parent（`SubtaskDrawerContext.tsx` 第 42-56 行）。
- `task` 工具从 `metadata.sessionId/sessionID` 取子会话 ID；存在时渲染“查看子任务”按钮，点击打开抽屉并带上父 session/message/part 定位（`ToolPart/index.tsx` 第 313-318 行、第 386-429 行）。
- 打开抽屉或父卡片看到子会话 ID 后都会调用 `ensureSession(subtaskSessionId)` 补拉子会话历史（`ToolPart/index.tsx` 第 340-343 行；`SubtaskDrawer.tsx` 第 99-119 行）。
- 抽屉在 cold 状态下显示 loading，加载失败显示“子任务加载失败”和重试按钮（`SubtaskDrawer.tsx` 第 66-78 行、第 145-164 行）。
- 抽屉消息列表读取 `getMessagesBySession(sessionID)`，并传入 `MessageRow` 的 `sessionID` 是子会话 ID；没有切换全局 `currentSession`（`SubtaskMessageList.tsx` 第 17-35 行、第 75-83 行）。
- 子会话消息会按 `message.info.time.created` 排序，避免历史补拉顺序影响展示（`SubtaskMessageList.tsx` 第 23-25 行）。
- 子任务 pending question 独立渲染为 `QuestionPart`，不依赖父会话消息列表（`SubtaskMessageList.tsx` 第 21 行、第 86-91 行）。
- 子任务消息列表复用 `useMessageScroll`，挂载后主动 `scrollToBottom()`，并保留滚到底按钮（`SubtaskMessageList.tsx` 第 30-42 行、第 101-108 行）。
- 抽屉头部展示 task 标题、subagent 类型、工具调用数和当前工具/完成态；加载失败时显示重试按钮（`SubtaskDrawer.tsx` 第 18-87 行、第 145-164 行）。
- 抽屉支持 Esc 关闭，点击 backdrop 关闭，点击抽屉内容不会冒泡关闭（`SubtaskDrawer.tsx` 第 89-97 行、第 225-249 行）。
- 宽度拖拽只存在于 `ResizableDrawer` 局部 `useState(defaultWidth)`，默认 90vw，最小 360px，最大 90vw；没有写入 repo 或 local storage（`SubtaskDrawer.tsx` 第 123-127 行、第 170-251 行）。
- 拖拽时只监听 `pointermove/pointerup/pointercancel`，组件卸载时清理监听和 `userSelect`（`SubtaskDrawer.tsx` 第 186-223 行）。
- 父 task 卡片会扫描子会话 pending permission/question：permission 标 amber，question 标 blue，点击阻塞态直接打开抽屉（`ToolPart/index.tsx` 第 320-325 行、第 365-367 行、第 391-400 行）。
- 父 task 卡片进度会统计子会话 tool part 数量，并显示当前 pending/running 工具名（`ToolPart/index.tsx` 第 357-381 行）。
- `subagent_type` 从 task input 读取并显示到父卡和抽屉头部（`ToolPart/index.tsx` 第 334-338 行；`SubtaskDrawer.tsx` 第 80-87 行）。
- `TaskTool` 只展示 completed task output 解析后的 markdown 文本；空结果显示“无可展示内容”（`TaskTool.tsx` 第 8-14 行）。
- 子任务消息列表复用普通 `MessageRow`，因此工具卡、markdown、question 的展示规则与主消息流一致（`SubtaskMessageList.tsx` 第 75-91 行）。

## 边界与约束

- 抽屉是观察子会话，不是会话切换器；不要在打开抽屉时改 `SessionContext` 的 current session。
- 宽度拖拽是会话内临时 UI 状态，刷新或关闭后恢复默认值。
- 实验性后台子 agent 的 UI 线索来自 `subagent_type` 与 `task_status` 工具；`task_status` 工具本身由后端实验开关控制，相关后端入口见 [packages-opencode 参考](../repositories/packages-opencode.md)。
- 抽屉依赖子会话 ID 写入 task metadata；缺少 metadata 时父卡不会出现抽屉入口。

## 运行时待核验

- [ ] 子任务 permission/question 在真实阻塞事件下，父卡标记和抽屉内回复入口是否同步消失（`待运行时核验`：需要真实子会话阻塞）。
- [ ] `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` 下 `task_status` 后台轮询与抽屉展示是否一致（`待运行时核验`：需要启用实验开关）。

## 相关

- 工具卡片渲染：[tool-rendering](tool-rendering.md)
- 状态面板：[status-panel](status-panel.md)
